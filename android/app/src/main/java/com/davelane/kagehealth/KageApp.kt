package com.davelane.kagehealth

import android.app.Application
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * Application-scoped setup:
 *   1. Schedules the periodic [SyncWorker] as a BACKUP path (WorkManager
 *      alone is unreliable on Samsung OneUI, but it costs nothing to have
 *      it running \u2014 belt and suspenders).
 *   2. Starts the [SyncService] foreground service, which is the ACTUAL
 *      reliable sync path. Only started if the user has finished setup
 *      (worker URL + API-SECRET entered) \u2014 no point spinning an idle
 *      service otherwise.
 */
class KageApp : Application() {

    override fun onCreate() {
        super.onCreate()
        schedulePeriodicSync()
        if (Prefs(this).isConfigured) {
            SyncService.start(this)
            WatchdogReceiver.schedule(this)  // heartbeat: restart service if killed
        }
    }

    private fun schedulePeriodicSync() {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val request = PeriodicWorkRequestBuilder<SyncWorker>(
            15, TimeUnit.MINUTES,   // repeat interval (min allowed by Android)
        )
            .setConstraints(constraints)
            .build()

        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            SyncWorker.UNIQUE_PERIODIC,
            ExistingPeriodicWorkPolicy.KEEP,
            request,
        )
    }
}
