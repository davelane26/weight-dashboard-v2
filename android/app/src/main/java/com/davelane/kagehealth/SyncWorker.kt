package com.davelane.kagehealth

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * WorkManager worker: reads today's Health Connect snapshot and POSTs it
 * to the Cloudflare Worker.
 *
 * Called from:
 *   - KageApp scheduling (periodic every 15 min)
 *   - MainActivity "Sync now" button (one-shot via WorkManager.enqueueUniqueWork)
 */
class SyncWorker(
    ctx: Context,
    params: WorkerParameters,
) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result {
        val prefs = Prefs(applicationContext)

        if (!prefs.isConfigured) {
            prefs.lastSyncStatus = "not configured"
            prefs.lastSyncEpochMs = System.currentTimeMillis()
            return Result.success()
        }
        if (!HealthConnectReader.isAvailable(applicationContext)) {
            prefs.lastSyncStatus = "Health Connect not installed"
            prefs.lastSyncEpochMs = System.currentTimeMillis()
            return Result.success()
        }

        // Check permissions explicitly so we distinguish "revoked permissions"
        // from "legit empty day" — previously both surfaced as "no metrics".
        if (!HealthConnectReader.hasAllPermissions(applicationContext)) {
            prefs.lastSyncStatus = "PERMISSIONS REVOKED — tap Grant button"
            prefs.lastSyncEpochMs = System.currentTimeMillis()
            return Result.success()
        }

        val snap = HealthConnectReader.readSnapshot(applicationContext)
        if (snap == null) {
            prefs.lastSyncStatus = "no data (permissions?)"
            prefs.lastSyncEpochMs = System.currentTimeMillis()
            return Result.success()
        }

        val result = withContext(Dispatchers.IO) {
            WorkerClient.postSnapshot(prefs.workerUrl, prefs.apiSecret, snap)
        }

        // Store the last known steps for the status card. Other metrics are
        // just fired-and-forgotten — the dashboard shows them, no need to
        // duplicate the display here.
        snap.steps?.let { prefs.lastStepsSent = it.toInt() }
        prefs.lastSyncEpochMs = System.currentTimeMillis()
        prefs.lastSyncStatus = if (result.ok) {
            "OK: ${summarize(snap)}"
        } else {
            "FAIL: ${result.status}"
        }

        return if (result.ok) Result.success() else Result.retry()
    }

    /** Short human-readable summary of what was sent, for the status card. */
    private fun summarize(s: HealthConnectReader.Snapshot): String {
        val parts = mutableListOf<String>()
        s.steps?.let         { parts += "$it steps" }
        s.avgHR?.let         { parts += "HR ${it.toInt()}" }
        s.sleepHours?.let    { parts += "sleep ${it}h" }
        s.activeCalories?.let{ parts += "${it.toInt()} kcal" }
        s.intensityMinutes?.let { if (it > 0) parts += "${it}min wkt" }
        return if (parts.isEmpty()) "no metrics" else parts.joinToString(" · ")
    }

    companion object {
        const val UNIQUE_PERIODIC = "kage-health-periodic"
        const val UNIQUE_ONE_SHOT = "kage-health-oneshot"
    }
}
