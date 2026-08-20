package com.davelane.kagehealth

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock

/**
 * Independent watchdog that fires every WATCHDOG_INTERVAL_MS and restarts
 * [SyncService] if it's been killed.
 *
 * Why we need this: Samsung OneUI ignores Android's spec and lets users
 * dismiss ongoing foreground-service notifications via "Clear all". Once
 * the notification is gone, Android kills the service within seconds. Then
 * we have zero background sync until the user reopens the app.
 *
 * AlarmManager has no notification and can't be dismissed by Clear All.
 * Even better: setExactAndAllowWhileIdle survives Doze mode (though it
 * costs battery, so we only use it when necessary).
 *
 * The receiver fires SyncService.start() which is idempotent: if the
 * service is alive, this is a no-op (startService on a running service
 * just calls onStartCommand again, which we guard against re-launching
 * the sync loop). If dead, it restarts it.
 */
class WatchdogReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent?) {
        // Only start the service if configured \u2014 no point running an idle
        // service that just spins in "waiting for setup" mode.
        if (Prefs(context).isConfigured) {
            SyncService.start(context)
        }
        // Reschedule ourselves for the next tick \u2014 setExactAndAllowWhileIdle
        // is one-shot, not repeating. Setting a new alarm inside the receiver
        // is the canonical pattern for reliable periodic wakeups on Doze.
        schedule(context)
    }

    companion object {
        const val WATCHDOG_INTERVAL_MS = 15L * 60L * 1000L  // 15 min
        private const val REQUEST_CODE = 42

        /**
         * (Re)schedule the next watchdog tick. Safe to call multiple times \u2014
         * FLAG_UPDATE_CURRENT replaces any existing alarm with the same
         * request code.
         */
        fun schedule(context: Context) {
            val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val intent = Intent(context, WatchdogReceiver::class.java)
            val pending = PendingIntent.getBroadcast(
                context, REQUEST_CODE, intent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val triggerAt = SystemClock.elapsedRealtime() + WATCHDOG_INTERVAL_MS

            // setExactAndAllowWhileIdle works even under Doze, unlike setInexactRepeating.
            // We accept the battery cost because guaranteed 15-min health sync is the whole point.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setExactAndAllowWhileIdle(
                    AlarmManager.ELAPSED_REALTIME_WAKEUP,
                    triggerAt,
                    pending,
                )
            } else {
                am.setExact(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pending)
            }
        }
    }
}
