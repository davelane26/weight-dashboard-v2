# ProGuard rules for release builds.
# WorkManager, Compose, and Health Connect all publish their own consumer rules,
# so we don't need much here for Phase 1.

# Keep kotlinx.serialization generated code
-keep,includedescriptorclasses class com.davelane.kagehealth.**$$serializer { *; }
-keepclassmembers class com.davelane.kagehealth.** {
    *** Companion;
}
-keepclasseswithmembers class com.davelane.kagehealth.** {
    kotlinx.serialization.KSerializer serializer(...);
}
