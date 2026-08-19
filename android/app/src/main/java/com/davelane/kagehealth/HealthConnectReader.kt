package com.davelane.kagehealth

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.aggregate.AggregationResult
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.time.TimeRangeFilter
import java.time.LocalDate
import java.time.ZoneId

/**
 * Reads today's step total from Health Connect.
 *
 * Phase 1 scope: steps only. Phase 2 will add HR, sleep, workouts, calories.
 *
 * Design notes:
 *   - Uses aggregate (not raw records) so we get a single sum instead of
 *     having to walk N thousand 1-minute buckets ourselves.
 *   - Time window is "midnight local time to now" so the number matches what
 *     Samsung Health shows in its "today" card.
 */
object HealthConnectReader {

    /**
     * Health Connect permissions we need. Currently just steps read.
     * Add to this set when extending to Phase 2.
     */
    val PERMISSIONS: Set<String> = setOf(
        HealthPermission.getReadPermission(StepsRecord::class),
    )

    /** True if Health Connect is installed and available on this device. */
    fun isAvailable(context: Context): Boolean =
        HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE

    /**
     * Returns today's step total, or null if Health Connect has no data
     * (e.g., permissions not granted, watch not synced, etc.).
     */
    suspend fun readTodaySteps(context: Context): Long? {
        if (!isAvailable(context)) return null

        val client = HealthConnectClient.getOrCreate(context)

        val zone = ZoneId.systemDefault()
        val startOfDay = LocalDate.now(zone).atStartOfDay(zone).toInstant()
        val now = java.time.Instant.now()

        return try {
            val response: AggregationResult = client.aggregate(
                AggregateRequest(
                    metrics = setOf(StepsRecord.COUNT_TOTAL),
                    timeRangeFilter = TimeRangeFilter.between(startOfDay, now),
                )
            )
            response[StepsRecord.COUNT_TOTAL]
        } catch (e: SecurityException) {
            // Permission not granted — treat as no data rather than crash.
            null
        }
    }
}
