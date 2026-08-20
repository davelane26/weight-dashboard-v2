package com.davelane.kagehealth

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.FloorsClimbedRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.records.metadata.DataOrigin
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * Reads today's Health Connect snapshot: steps, HR (min/max/avg/resting),
 * last-night's sleep with stages, active/total calories, floors, workout
 * minutes.
 *
 * All fields are optional — if a metric has no data (permission missing,
 * sensor not writing to Health Connect, etc.) we just leave it null in
 * the Snapshot and let the /health/patch endpoint's merge logic preserve
 * whatever the previous value was.
 */
object HealthConnectReader {

    /**
     * Combined Health Connect snapshot for today. All fields nullable because
     * we don't want a missing HR reading to prevent the steps count from
     * being pushed.
     */
    data class Snapshot(
        val steps: Long? = null,
        val restingHR: Long? = null,
        val minHR: Long? = null,
        val maxHR: Long? = null,
        val avgHR: Double? = null,
        val activeCalories: Double? = null,   // kcal
        val totalCalories: Double? = null,    // kcal
        val floorsClimbed: Double? = null,
        val intensityMinutes: Long? = null,   // total workout minutes today
        val sleepHours: Double? = null,       // last night's total
        val sleepDeep: Double? = null,        // hours in deep stage
        val sleepLight: Double? = null,
        val sleepRem: Double? = null,
        val sleepAwakenings: Long? = null,    // count of "awake" segments
    )

    /**
     * Full set of Health Connect permissions the app needs. Passed to the
     * PermissionController.createRequestPermissionResultContract() launcher.
     */
    val PERMISSIONS: Set<String> = setOf(
        HealthPermission.getReadPermission(StepsRecord::class),
        HealthPermission.getReadPermission(HeartRateRecord::class),
        HealthPermission.getReadPermission(RestingHeartRateRecord::class),
        HealthPermission.getReadPermission(SleepSessionRecord::class),
        HealthPermission.getReadPermission(ExerciseSessionRecord::class),
        HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class),
        HealthPermission.getReadPermission(TotalCaloriesBurnedRecord::class),
        HealthPermission.getReadPermission(FloorsClimbedRecord::class),
    )

    /**
     * Check whether we ACTUALLY have permission to read all our record types.
     * Health Connect can silently revoke permissions (Samsung's auto-revoke,
     * HC app updates, user action) and our reads then throw SecurityException
     * which safeAggregate swallows — leading to "OK: no metrics" instead of
     * a clear "permissions revoked, tap Grant" signal.
     */
    suspend fun hasAllPermissions(context: Context): Boolean {
        if (!isAvailable(context)) return false
        return try {
            val client = HealthConnectClient.getOrCreate(context)
            val granted = client.permissionController.getGrantedPermissions()
            granted.containsAll(PERMISSIONS)
        } catch (e: Exception) {
            false
        }
    }

    fun isAvailable(context: Context): Boolean =
        HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE

    /**
     * Read everything, tolerantly. A single metric throwing SecurityException
     * (permission not granted) or IllegalStateException (nothing recorded)
     * shouldn't take down the whole sync — we swallow per-metric and continue.
     */
    suspend fun readSnapshot(context: Context): Snapshot? {
        if (!isAvailable(context)) return null
        val client = HealthConnectClient.getOrCreate(context)

        val zone = ZoneId.systemDefault()
        val startOfDay = LocalDate.now(zone).atStartOfDay(zone).toInstant()
        val now = Instant.now()
        val today = TimeRangeFilter.between(startOfDay, now)

        val steps = readTodaySteps(client, startOfDay, now)
        val minHR = safeAggregate {
            client.aggregate(AggregateRequest(setOf(HeartRateRecord.BPM_MIN), today))
                .get(HeartRateRecord.BPM_MIN)
        }
        val maxHR = safeAggregate {
            client.aggregate(AggregateRequest(setOf(HeartRateRecord.BPM_MAX), today))
                .get(HeartRateRecord.BPM_MAX)
        }
        val avgHR = safeAggregate {
            client.aggregate(AggregateRequest(setOf(HeartRateRecord.BPM_AVG), today))
                .get(HeartRateRecord.BPM_AVG)
        }?.toDouble()
        val activeCal = safeAggregate {
            client.aggregate(AggregateRequest(setOf(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL), today))
                .get(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL)?.inKilocalories
        }
        val totalCal = safeAggregate {
            client.aggregate(AggregateRequest(setOf(TotalCaloriesBurnedRecord.ENERGY_TOTAL), today))
                .get(TotalCaloriesBurnedRecord.ENERGY_TOTAL)?.inKilocalories
        }
        val floors = safeAggregate {
            client.aggregate(AggregateRequest(setOf(FloorsClimbedRecord.FLOORS_CLIMBED_TOTAL), today))
                .get(FloorsClimbedRecord.FLOORS_CLIMBED_TOTAL)
        }

        val restingHR = readRestingHR(client)
        val workoutMins = readWorkoutMinutes(client, today)
        val sleep = readLastNightSleep(client, now)

        return Snapshot(
            steps = steps,
            minHR = minHR,
            maxHR = maxHR,
            avgHR = avgHR,
            restingHR = restingHR,
            activeCalories = activeCal,
            totalCalories = totalCal,
            floorsClimbed = floors,
            intensityMinutes = workoutMins,
            sleepHours = sleep?.hours,
            sleepDeep = sleep?.deep,
            sleepLight = sleep?.light,
            sleepRem = sleep?.rem,
            sleepAwakenings = sleep?.awakenings,
        )
    }

    /**
     * Samsung Health's Android package name — used to filter Health Connect
     * reads to ONLY records originally written by Samsung Health, ignoring
     * duplicates written by other apps (Health Sync writes Samsung's data
     * back to HC with a different origin, causing double-counting).
     */
    private const val SAMSUNG_HEALTH_PACKAGE = "com.sec.android.app.shealth"
    private val SAMSUNG_ONLY: Set<DataOrigin> =
        setOf(DataOrigin(SAMSUNG_HEALTH_PACKAGE))

    /**
     * Read today's total steps by SUMMING raw StepsRecord entries whose
     * time window overlaps today AND whose data origin is Samsung Health,
     * WITHOUT the aggregate helper's automatic clipping.
     *
     * Why not aggregate(): Samsung Health writes a single daily-total record
     * spanning 00:00–23:59 with the full-day count. Health Connect's aggregate
     * API clips that record proportionally to the filter window — so a query
     * for "midnight to now" at 17:13 returns 71.9% of the day's steps
     * (~4860 out of 6805), not the actual current cumulative count.
     *
     * Why filter by dataOrigin: multiple apps (Health Sync, Garmin Connect,
     * others) can write StepsRecords to HC. Even if you remove them from
     * the priority list in HC's UI, their historical records remain and
     * a plain read would sum them all — inflating the total. Restricting
     * to Samsung Health origin ensures we get exactly one authoritative
     * count matching what Samsung's own UI shows.
     */
    private suspend fun readTodaySteps(
        client: HealthConnectClient,
        startOfDay: Instant,
        now: Instant,
    ): Long? = runCatching {
        val resp = client.readRecords(
            ReadRecordsRequest(
                recordType = StepsRecord::class,
                timeRangeFilter = TimeRangeFilter.between(startOfDay, now),
                dataOriginFilter = SAMSUNG_ONLY,
            )
        )
        if (resp.records.isEmpty()) return@runCatching null
        resp.records.sumOf { it.count }
    }.getOrNull()

    /**
     * Resting HR: read most recent RestingHeartRateRecord in the last 48h
     * and return its beatsPerMinute. Samsung Health writes this once daily
     * (usually early morning) so we look back further than "today".
     */
    private suspend fun readRestingHR(client: HealthConnectClient): Long? {
        return runCatching {
            val since = Instant.now().minus(Duration.ofHours(48))
            val resp = client.readRecords(
                ReadRecordsRequest(
                    recordType = RestingHeartRateRecord::class,
                    timeRangeFilter = TimeRangeFilter.after(since),
                )
            )
            resp.records
                .maxByOrNull { it.time }
                ?.beatsPerMinute
        }.getOrNull()
    }

    /**
     * Sum of all workout durations that started today, in whole minutes.
     * Doesn't distinguish workout types — just "how many active minutes."
     */
    private suspend fun readWorkoutMinutes(
        client: HealthConnectClient,
        today: TimeRangeFilter,
    ): Long? {
        return runCatching {
            val resp = client.readRecords(
                ReadRecordsRequest(
                    recordType = ExerciseSessionRecord::class,
                    timeRangeFilter = today,
                )
            )
            if (resp.records.isEmpty()) return null
            resp.records
                .sumOf { Duration.between(it.startTime, it.endTime).toMinutes() }
                .coerceAtLeast(0L)
        }.getOrNull()
    }

    /** Parsed sleep summary from Health Connect stage segments. */
    private data class SleepSummary(
        val hours: Double,
        val deep: Double?,
        val light: Double?,
        val rem: Double?,
        val awakenings: Long?,
    )

    /**
     * "Last night's" sleep: find the most recent SleepSessionRecord that
     * ended in the last 30 hours. Aggregate stage segments into deep/light/rem
     * totals in hours, and count "awake" segments as awakenings.
     */
    private suspend fun readLastNightSleep(
        client: HealthConnectClient,
        now: Instant,
    ): SleepSummary? {
        return runCatching {
            val since = now.minus(Duration.ofHours(30))
            val resp = client.readRecords(
                ReadRecordsRequest(
                    recordType = SleepSessionRecord::class,
                    timeRangeFilter = TimeRangeFilter.between(since, now),
                )
            )
            val session = resp.records.maxByOrNull { it.endTime } ?: return null
            val totalHours =
                Duration.between(session.startTime, session.endTime).toMinutes() / 60.0

            var deep = 0.0; var light = 0.0; var rem = 0.0
            var awakeSegs = 0L
            for (stage in session.stages) {
                val h = Duration.between(stage.startTime, stage.endTime).toMinutes() / 60.0
                when (stage.stage) {
                    SleepSessionRecord.STAGE_TYPE_DEEP -> deep += h
                    SleepSessionRecord.STAGE_TYPE_LIGHT -> light += h
                    SleepSessionRecord.STAGE_TYPE_REM -> rem += h
                    SleepSessionRecord.STAGE_TYPE_AWAKE,
                    SleepSessionRecord.STAGE_TYPE_AWAKE_IN_BED -> awakeSegs += 1
                    else -> {}
                }
            }

            SleepSummary(
                hours = round2(totalHours),
                deep = deep.takeIf { it > 0 }?.let(::round2),
                light = light.takeIf { it > 0 }?.let(::round2),
                rem = rem.takeIf { it > 0 }?.let(::round2),
                awakenings = awakeSegs.takeIf { it > 0 },
            )
        }.getOrNull()
    }

    private fun round2(d: Double): Double = Math.round(d * 100.0) / 100.0

    /**
     * Wrap Health Connect calls so a per-metric SecurityException / missing
     * data / API drift doesn't torpedo the entire sync.
     */
    private inline fun <T> safeAggregate(block: () -> T?): T? =
        runCatching(block).getOrNull()
}
