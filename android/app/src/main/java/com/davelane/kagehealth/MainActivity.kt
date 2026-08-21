package com.davelane.kagehealth

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Single-screen Compose UI:
 *   - Health Connect status (installed? permissions granted?)
 *   - Worker URL + auth token config
 *   - "Grant Permissions" button (launches Health Connect UI)
 *   - "Sync now" button (enqueues one-shot SyncWorker)
 *   - Live status card showing last sync result
 */
class MainActivity : ComponentActivity() {

    // Health Connect uses its own ActivityResultContract for permissions,
    // provided by the PermissionController.
    private val requestPermissions =
        registerForActivityResult(
            PermissionController.createRequestPermissionResultContract()
        ) { granted ->
            // UI will refresh via LaunchedEffect polling. No action needed here.
        }

    // Android 13+: runtime permission for the ongoing foreground-service
    // notification. Without this granted, the persistent notification is
    // silently suppressed (though the service itself still runs).
    private val requestNotificationPerm =
        registerForActivityResult(
            ActivityResultContracts.RequestPermission()
        ) { /* result not needed — UI polls */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        maybeRequestNotificationPermission()
        maybeStartSyncService()
        setContent {
            KageTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    MainScreen(
                        onRequestPermissions = {
                            requestPermissions.launch(HealthConnectReader.PERMISSIONS)
                        }
                    )
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // If the user updated their config while the app was backgrounded,
        // (re)start the service so it picks up the new URL/secret.
        maybeStartSyncService()
    }

    private fun maybeStartSyncService() {
        if (Prefs(this).isConfigured) {
            SyncService.start(this)
            WatchdogReceiver.schedule(this)  // ensure heartbeat is armed
        }
    }

    private fun maybeRequestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
            if (!granted) requestNotificationPerm.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
private fun MainScreen(onRequestPermissions: () -> Unit) {
    val context = LocalContext.current
    val prefs = remember { Prefs(context) }

    var workerUrl by remember { mutableStateOf(prefs.workerUrl) }
    var authToken by remember { mutableStateOf(prefs.apiSecret) }
    var primaryOrigin by remember { mutableStateOf(prefs.primaryOrigin) }

    // Poll prefs every 2s so status card refreshes without needing a proper StateFlow.
    // Yes it's crude. It's a single-screen personal app. Ship it.
    var tick by remember { mutableStateOf(0) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(2_000)
            tick += 1
        }
    }

    val hcAvailable = remember(tick) { HealthConnectReader.isAvailable(context) }
    val permissionsGranted = remember(tick, hcAvailable) {
        if (!hcAvailable) false
        else runCatching {
            val client = HealthConnectClient.getOrCreate(context)
            // Note: getGrantedPermissions is a suspend fn — for a UI-friendly
            // synchronous read we assume permissions are granted if we can
            // successfully aggregate. Instead we just show the button always
            // and let the user grant if needed.
            true
        }.getOrDefault(false)
    }

    val lastSyncMs = remember(tick) { prefs.lastSyncEpochMs }
    val lastStatus = remember(tick) { prefs.lastSyncStatus }
    val lastSteps = remember(tick) { prefs.lastStepsSent }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Kage Health Bridge") },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer,
                    titleContentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                )
            )
        }
    ) { innerPadding: PaddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // Status card
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant,
                )
            ) {
                Column(Modifier.padding(16.dp)) {
                    Text(
                        "Status",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text("Health Connect: ${if (hcAvailable) "installed" else "NOT installed"}")
                    Text("Last sync: ${formatTs(lastSyncMs)}")
                    Text(
                        "Result: $lastStatus",
                        fontFamily = FontFamily.Monospace,
                    )
                    if (lastSteps >= 0) Text("Last steps sent: $lastSteps")
                }
            }

            // Config
            OutlinedTextField(
                value = workerUrl,
                onValueChange = {
                    workerUrl = it
                    prefs.workerUrl = it
                },
                label = { Text("Worker base URL") },
                placeholder = { Text("https://glucose-relay.example.workers.dev") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )

            OutlinedTextField(
                value = authToken,
                onValueChange = {
                    authToken = it
                    prefs.apiSecret = it
                },
                label = { Text("API-SECRET (Worker's API_SECRET env var)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )

            // Primary data-origin selector — which watch "wins" when both
            // Samsung Health AND Garmin Connect write the same metric today.
            // Fallback to the other source kicks in automatically if the
            // primary has no data.
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant,
                )
            ) {
                Column(Modifier.padding(16.dp)) {
                    Text(
                        "Primary data source",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        "For sum-type metrics (steps, distance, calories, floors, " +
                            "workouts). Falls back to the other if primary has no data.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(
                            selected = primaryOrigin == HealthConnectReader.ORIGIN_SAMSUNG,
                            onClick = {
                                primaryOrigin = HealthConnectReader.ORIGIN_SAMSUNG
                                prefs.primaryOrigin = HealthConnectReader.ORIGIN_SAMSUNG
                            },
                            label = { Text("Samsung Health") },
                        )
                        FilterChip(
                            selected = primaryOrigin == HealthConnectReader.ORIGIN_GARMIN,
                            onClick = {
                                primaryOrigin = HealthConnectReader.ORIGIN_GARMIN
                                prefs.primaryOrigin = HealthConnectReader.ORIGIN_GARMIN
                            },
                            label = { Text("Garmin Connect") },
                        )
                    }
                }
            }

            // Actions
            Button(
                onClick = onRequestPermissions,
                enabled = hcAvailable,
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Grant Health Connect Permissions") }

            Button(
                onClick = {
                    val req = OneTimeWorkRequestBuilder<SyncWorker>().build()
                    WorkManager.getInstance(context).enqueueUniqueWork(
                        SyncWorker.UNIQUE_ONE_SHOT,
                        ExistingWorkPolicy.REPLACE,
                        req,
                    )
                },
                enabled = prefs.isConfigured && hcAvailable,
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Sync now") }

            Text(
                "Background sync runs every 15 min automatically once configured. " +
                    "Add this app to your battery 'Never sleeping' list so Android " +
                    "doesn't kill it.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

private fun formatTs(ms: Long): String =
    if (ms == 0L) "never"
    else SimpleDateFormat("MMM d, HH:mm:ss", Locale.US).format(Date(ms))

@Composable
private fun KageTheme(content: @Composable () -> Unit) {
    MaterialTheme(content = content)
}
