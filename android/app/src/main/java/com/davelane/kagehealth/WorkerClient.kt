package com.davelane.kagehealth

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDate
import java.time.ZoneId

/**
 * HTTP POST helper for the Cloudflare Worker's /health/patch endpoint.
 *
 * Uses HttpURLConnection (stdlib) instead of OkHttp so the APK stays small.
 * We have one endpoint to hit — no client library needed.
 *
 * Auth model: /health/patch uses the API-SECRET header (xDrip+-compatible),
 * NOT Authorization: Bearer (which is Firebase-token auth for /weight.json).
 * See cloudflare-worker/worker.js isAuthorized() around line 77.
 */
object WorkerClient {

    data class Result(val ok: Boolean, val status: String)

    /**
     * POST { date: today, ...fields } to $workerUrl/health/patch.
     *
     * The Worker's /health/patch endpoint merges fields into today's record
     * and preserves fields from other sources — so we can safely send only
     * what we have without wiping Garmin-patched sleepScore, etc.
     */
    fun postSnapshot(
        workerUrl: String,
        apiSecret: String,
        snap: HealthConnectReader.Snapshot,
    ): Result {
        val today = LocalDate.now(ZoneId.systemDefault()).toString()  // YYYY-MM-DD
        val body: JsonObject = buildJsonObject {
            put("date", today)
            snap.steps?.let            { put("steps", it) }
            snap.restingHR?.let        { put("restingHR", it) }
            snap.minHR?.let            { put("minHR", it) }
            snap.maxHR?.let            { put("maxHR", it) }
            snap.avgHR?.let            { put("avgHR", it) }
            snap.currentHR?.let        { put("currentHR", it) }
            snap.activeCalories?.let   { put("activeCalories", it) }
            snap.totalCalories?.let    { put("totalCalories", it) }
            snap.floorsClimbed?.let    { put("floorsClimbed", it) }
            // intensityMinutes intentionally NOT sent from Kage: the Garmin-bookmarklet
            // is the authoritative source for that field (uses Garmin's real
            // moderate + 2*vigorous calculation from HR zones). Kage's ExerciseSessionRecord
            // sum systematically undercounts because non-workout activity (walking around
            // life, chores) doesn't get recorded as an exercise session but does raise HR
            // into moderate/vigorous zones. Sending Kage's smaller number every 15 min
            // was overwriting the bookmarklet's accurate value.
            //
            // v0.4.3: send that same number under workoutsMins instead — the field
            // name the Samsung Health bridge already uses for the same
            // sum-of-session-durations methodology. The dashboard's Active Minutes
            // tile falls back to workoutsMins when intensityMinutes is absent, so
            // Kage-only users (no bookmarklet run) get a real number instead of a
            // permanently blank tile, without touching the bookmarklet's field.
            snap.intensityMinutes?.let { put("workoutsMins", it) }
            snap.sleepHours?.let       { put("sleepHours", it) }
            snap.sleepDeep?.let        { put("sleepDeep", it) }
            snap.sleepLight?.let       { put("sleepLight", it) }
            snap.sleepRem?.let         { put("sleepRem", it) }
            snap.sleepAwakenings?.let  { put("sleepAwakenings", it) }
            // v0.3.4 additions
            snap.distanceMeters?.let   { put("distanceMeters", it) }
            snap.spo2Avg?.let          { put("spo2Avg", it) }
            snap.spo2Min?.let          { put("spo2Min", it) }
            snap.hrvRmssd?.let         { put("hrvRmssd", it) }
            snap.vo2Max?.let           { put("vo2Max", it) }
            snap.bedtime?.let          { put("bedtime", it) }
            snap.waketime?.let         { put("waketime", it) }
        }
        return postJson("$workerUrl/health/patch", apiSecret, body.toString())
    }

    private fun postJson(url: String, apiSecret: String, jsonBody: String): Result {
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 15_000
                readTimeout = 15_000
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("API-SECRET", apiSecret)
                doOutput = true
            }
            OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { it.write(jsonBody) }
            val code = conn.responseCode
            if (code in 200..299) {
                Result(true, "HTTP $code OK")
            } else {
                val err = conn.errorStream?.bufferedReader()?.use { it.readText() }?.take(200)
                    ?: "no body"
                Result(false, "HTTP $code: $err")
            }
        } catch (e: Exception) {
            Result(false, "error: ${e.javaClass.simpleName}: ${e.message?.take(150)}")
        } finally {
            conn?.disconnect()
        }
    }
}
