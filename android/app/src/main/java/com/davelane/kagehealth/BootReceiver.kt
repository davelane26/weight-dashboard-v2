package com.davelane.kagehealth

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Restarts [SyncService] after phone reboot or after our own APK is replaced
 * (i.e. an update install). Without this, the user would have to manually
 * open the Kage app after every reboot for background sync to resume \u2014
 * defeating the whole point of "background."
 *
 * Registered in AndroidManifest.xml for BOOT_COMPLETED and MY_PACKAGE_REPLACED
 * intents.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        if (action == Intent.ACTION_BOOT_COMPLETED ||
            action == Intent.ACTION_MY_PACKAGE_REPLACED
        ) {
            // Only start the service if the user has finished setup (worker
            // URL + secret entered). No point starting an idle service that
            // just spins in "waiting for setup" mode.
            if (Prefs(context).isConfigured) {
                SyncService.start(context)
                WatchdogReceiver.schedule(context)  // re-arm heartbeat after reboot
            }
        }
    }
}
