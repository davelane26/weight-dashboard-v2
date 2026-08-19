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
 * Uses HttpURLConnection (stdlib) instead of OkHttp to keep the APK tiny.
 * We have one endpoint to hit. No client library needed.
 */
object WorkerClient {

    data class Result(val ok: Boolean, val status: String)

    /**
     * POST { date: today, steps: N } to $workerUrl/health/patch.
     *
     * The Worker's /health/patch endpoint (see cloudflare-worker/worker.js)
     * merges fields into today's record and preserves fields from other
     * sources — so we can safely send only what we know without wiping
     * out Garmin-patched sleepScore, etc.
     */
    fun postSteps(workerUrl: String, apiSecret: String, steps: Long): Result {
        val today = LocalDate.now(ZoneId.systemDefault()).toString()  // YYYY-MM-DD
        val body: JsonObject = buildJsonObject {
            put("date", today)
            put("steps", steps)
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
                // Worker's isAuthorized() checks the API-SECRET header (xDrip+-compatible).
                // Not to be confused with the Firebase Bearer auth used for /weight.json.
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
