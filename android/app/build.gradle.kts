plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.davelane.kagehealth"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.davelane.kagehealth"
        minSdk = 26          // Health Connect requires Android 8.0+
        targetSdk = 34
        versionCode = 12
        versionName = "0.4.0"
    }

    signingConfigs {
        // Create a NAMED signing config (instead of overriding AGP's built-in
        // `debug` config, which had ambiguous evaluation-order behavior).
        // The `debug.keystore` file is provided by GitHub Actions:
        // generated once on first build, cached across all subsequent runs
        // via actions/cache, so every APK is signed with the same cert.
        // Password is literally "android" — the Android debug convention.
        create("stableDebug") {
            storeFile = file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        debug {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("stableDebug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    // Health Connect
    implementation("androidx.health.connect:connect-client:1.1.0-alpha07")

    // WorkManager (background sync every 15 min)
    implementation("androidx.work:work-runtime-ktx:2.9.1")

    // Compose UI
    val composeBom = platform("androidx.compose:compose-bom:2024.09.02")
    implementation(composeBom)
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")

    // Core Android + activity
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.6")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    // Kotlin serialization for building JSON payloads without OkHttp/Retrofit
    // (keeping deps minimal — no OkHttp needed, HttpURLConnection is fine for one endpoint)
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.2")
}
