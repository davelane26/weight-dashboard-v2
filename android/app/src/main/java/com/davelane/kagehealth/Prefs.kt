package com.davelane.kagehealth

import android.content.Context
import android.content.SharedPreferences

/**
 * Thin SharedPreferences wrapper. Stores the Worker URL, auth token, and
 * last-sync status so the UI can display it.
 *
 * Deliberately not a fancy DataStore — this is 6 keys and we don't need
 * flows or transactional writes.
 */
class Prefs(context: Context) {
    private val sp: SharedPreferences =
        context.getSharedPreferences("kage_health", Context.MODE_PRIVATE)

    var workerUrl: String
        get() = sp.getString(KEY_URL, "") ?: ""
        set(v) = sp.edit().putString(KEY_URL, v.trim().trimEnd('/')).apply()

    var apiSecret: String
        get() = sp.getString(KEY_TOKEN, "") ?: ""
        set(v) = sp.edit().putString(KEY_TOKEN, v.trim()).apply()

    var lastSyncEpochMs: Long
        get() = sp.getLong(KEY_LAST_SYNC, 0L)
        set(v) = sp.edit().putLong(KEY_LAST_SYNC, v).apply()

    var lastSyncStatus: String
        get() = sp.getString(KEY_LAST_STATUS, "never synced") ?: "never synced"
        set(v) = sp.edit().putString(KEY_LAST_STATUS, v).apply()

    var lastStepsSent: Int
        get() = sp.getInt(KEY_LAST_STEPS, -1)
        set(v) = sp.edit().putInt(KEY_LAST_STEPS, v).apply()

    /**
     * Which Health Connect data origin to treat as authoritative for
     * sum-type metrics (steps, distance, calories, floors, workouts).
     * Fallback to the other source kicks in only if primary has no data.
     *
     * Values: HealthConnectReader.ORIGIN_SAMSUNG (default) or ORIGIN_GARMIN.
     */
    var primaryOrigin: String
        get() = sp.getString(KEY_PRIMARY_ORIGIN, HealthConnectReader.ORIGIN_SAMSUNG)
            ?: HealthConnectReader.ORIGIN_SAMSUNG
        set(v) = sp.edit().putString(KEY_PRIMARY_ORIGIN, v).apply()

    val isConfigured: Boolean
        get() = workerUrl.isNotBlank() && apiSecret.isNotBlank()

    companion object {
        private const val KEY_URL = "worker_url"
        private const val KEY_TOKEN = "auth_token"
        private const val KEY_LAST_SYNC = "last_sync_epoch_ms"
        private const val KEY_LAST_STATUS = "last_sync_status"
        private const val KEY_LAST_STEPS = "last_steps_sent"
        private const val KEY_PRIMARY_ORIGIN = "primary_origin"
    }
}
