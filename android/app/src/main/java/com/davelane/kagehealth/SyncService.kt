package com.davelane.kagehealth

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Foreground service that runs the sync loop every SYNC_INTERVAL_MS,
 * bulletproofed against Samsung OneUI's aggressive background killing.
 *
 * Why a foreground service instead of WorkManager alone:
 *   Samsung's OneUI (and other aggressive OEMs like Xiaomi, Huawei) throttle
 *   or kill WorkManager jobs even when Battery=Unrestricted, especially for
 *   apps the user doesn't manually open every day. Kage Health Bridge is
 *   exactly that kind of app \u2014 it's designed to run invisibly. So Samsung
 *   sees "user never opens this" and gets rid of it.
 *
 *   A foreground service with an ongoing notification is the ONLY category
 *   of background work Android/OEMs can't kill under normal circumstances.
 *   Trade-off: a persistent notification in the status bar. Worth it for
 *   guaranteed 15-min sync.
 *
 * We keep [SyncWorker] around for the "Sync Now" button in [MainActivity]
 * (WorkManager one-shot enqueue). This service and the button share the
 * same [HealthConnectReader] + [WorkerClient] pipeline, just triggered
 * differently.
 */
class SyncService : Service() {

    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var loopJob: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Start in foreground with the persistent notification IMMEDIATELY.
        // Android 12+ enforces a 5-second window after startForegroundService()
        // in which we MUST call startForeground() or the system throws
        // ForegroundServiceDidNotStartInTimeException.
        startForegroundWithNotification()

        // Start the sync loop once. onStartCommand can be called multiple
        // times (e.g. if the system restarts us) so guard against duplicate
        // coroutines piling up.
        if (loopJob?.isActive != true) {
            loopJob = scope.launch { syncLoop() }
        }

        // START_STICKY: if the OS kills us for memory, restart with a null
        // intent as soon as memory frees up. Combined with the foreground
        // notification this makes killing us very unusual.
        return START_STICKY
    }

    override fun onDestroy() {
        loopJob?.cancel()
        scope.cancel()
        super.onDestroy()
    }

    /**
     * The core sync loop. Reads Health Connect, POSTs to the Worker, updates
     * the notification with a summary, then sleeps SYNC_INTERVAL_MS before
     * looping. Runs on Dispatchers.Default; the HTTP POST inside runs on
     * Dispatchers.IO internally.
     */
    private suspend fun syncLoop() {
        while (true) {
            runCatching { performOneSync() }
                .onFailure { updateNotification("last sync failed: ${it.message?.take(60)}") }
            delay(SYNC_INTERVAL_MS)
        }
    }

    private suspend fun performOneSync() {
        updateNotification("checking config…")
        val prefs = Prefs(applicationContext)
        if (!prefs.isConfigured) {
            updateNotification("waiting for setup (open app)")
            return
        }

        updateNotification("checking Health Connect…")
        if (!HealthConnectReader.isAvailable(applicationContext)) {
            updateNotification("Health Connect not installed")
            return
        }
        if (!HealthConnectReader.hasAllPermissions(applicationContext)) {
            updateNotification("permissions revoked — tap to fix")
            prefs.lastSyncStatus = "PERMISSIONS REVOKED — tap Grant button"
            prefs.lastSyncEpochMs = System.currentTimeMillis()
            return
        }

        updateNotification("reading health data…")
        val snap = HealthConnectReader.readSnapshot(applicationContext)
        if (snap == null) {
            updateNotification("no data yet today")
            return
        }

        updateNotification("posting to worker…")
        // HTTP POST is blocking (HttpURLConnection) — route it to Dispatchers.IO
        // so we don't tie up the Dispatchers.Default thread pool.
        val result = withContext(Dispatchers.IO) {
            WorkerClient.postSnapshot(prefs.workerUrl, prefs.apiSecret, snap)
        }
        snap.steps?.let { prefs.lastStepsSent = it.toInt() }
        prefs.lastSyncEpochMs = System.currentTimeMillis()

        val stepsStr = snap.steps?.toString() ?: "—"
        prefs.lastSyncStatus = if (result.ok) "OK: $stepsStr steps" else "FAIL: ${result.status}"
        updateNotification(
            if (result.ok) "last sync: $stepsStr steps at ${nowHm()}"
            else "last sync FAILED at ${nowHm()}"
        )
    }

    private fun nowHm(): String {
        val cal = java.util.Calendar.getInstance()
        return String.format("%02d:%02d", cal.get(java.util.Calendar.HOUR_OF_DAY), cal.get(java.util.Calendar.MINUTE))
    }

    private fun startForegroundWithNotification() {
        createChannel()
        val notif = buildNotification("starting up\u2026")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            // Android 14+ requires explicit foregroundServiceType at startForeground()
            // Combined dataSync|health matches the AndroidManifest declaration.
            startForeground(
                NOTIF_ID,
                notif,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC or
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH,
            )
        } else {
            startForeground(NOTIF_ID, notif)
        }
    }

    private fun updateNotification(subtitle: String) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIF_ID, buildNotification(subtitle))
    }

    private fun buildNotification(subtitle: String): Notification {
        // Tapping the notification opens MainActivity so the user can see
        // the status card and re-grant permissions if needed.
        val openIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pending = PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("Kage Health Bridge")
            .setContentText(subtitle)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)  // user can't swipe it away \u2014 required for foreground
            .setContentIntent(pending)
            .setPriority(Notification.PRIORITY_MIN)  // low-profile in status bar
            .build()
    }

    private fun createChannel() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val existing = nm.getNotificationChannel(CHANNEL_ID)
        if (existing != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Background sync",
            NotificationManager.IMPORTANCE_LOW,  // no sound / no heads-up
        ).apply {
            description = "Keeps Samsung Health data flowing to your dashboard every 15 min."
            setShowBadge(false)
        }
        nm.createNotificationChannel(channel)
    }

    companion object {
        const val CHANNEL_ID = "kage-sync-channel"
        const val NOTIF_ID = 1
        const val SYNC_INTERVAL_MS = 15L * 60L * 1000L  // 15 minutes

        /** Start the service if not already running. Safe to call repeatedly. */
        fun start(context: Context) {
            val intent = Intent(context, SyncService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }
    }
}
