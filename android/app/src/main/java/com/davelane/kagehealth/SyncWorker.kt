package com.davelane.kagehealth

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * WorkManager worker that runs periodically (every 15 min minimum, per Android
 * platform limits) to read today's steps from Health Connect and POST them
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

        // No config? Nothing to do. Return success so we don't get retried forever.
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

        val steps = HealthConnectReader.readTodaySteps(applicationContext)
        if (steps == null) {
            prefs.lastSyncStatus = "no steps data (permissions?)"
            prefs.lastSyncEpochMs = System.currentTimeMillis()
            return Result.success()
        }

        val result = withContext(Dispatchers.IO) {
            WorkerClient.postSteps(prefs.workerUrl, prefs.apiSecret, steps)
        }

        prefs.lastStepsSent = steps.toInt()
        prefs.lastSyncEpochMs = System.currentTimeMillis()
        prefs.lastSyncStatus = if (result.ok) "OK: $steps steps sent" else "FAIL: ${result.status}"

        // Return retry on transient failures so WorkManager backs off and tries again.
        return if (result.ok) Result.success() else Result.retry()
    }

    companion object {
        const val UNIQUE_PERIODIC = "kage-health-periodic"
        const val UNIQUE_ONE_SHOT = "kage-health-oneshot"
    }
}
