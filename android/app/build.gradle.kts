plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.kotlin.android)
}

android {
  namespace = "dev.chethiya.orbit"
  compileSdk = 34

  defaultConfig {
    applicationId = "dev.chethiya.orbit"
    minSdk = 24
    targetSdk = 34
    versionCode = 115
    versionName = "1.0.15"

    ndk {
      abiFilters += listOf("arm64-v8a", "armeabi-v7a")
    }
  }

  signingConfigs {
    create("release") {
      val keystorePath = providers.environmentVariable("ORBIT_KEYSTORE").orNull
      if (!keystorePath.isNullOrBlank()) {
        storeFile = file(keystorePath)
        storePassword = providers.environmentVariable("ORBIT_KEYSTORE_PASSWORD").orNull
        keyAlias = providers.environmentVariable("ORBIT_KEY_ALIAS").orNull
        keyPassword = providers.environmentVariable("ORBIT_KEY_PASSWORD").orNull
      }
      enableV1Signing = true
      enableV2Signing = true
      enableV3Signing = true
    }
  }

  buildTypes {
    debug {
      // Use the Android debug key so a source checkout builds without release secrets.
      applicationIdSuffix = ".review"
      versionNameSuffix = "-review"
    }
    release {
      isMinifyEnabled = false
      if (!providers.environmentVariable("ORBIT_KEYSTORE").orNull.isNullOrBlank()) {
        signingConfig = signingConfigs.getByName("release")
      }
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  kotlinOptions {
    jvmTarget = "17"
  }

  buildFeatures {
    compose = false
    buildConfig = true
  }

  packaging {
    jniLibs {
      useLegacyPackaging = true
    }
    resources {
      excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
  }
}

dependencies {
  implementation(libs.androidx.core.ktx)
  implementation(libs.androidx.appcompat)
  implementation(libs.androidx.activity.ktx)
  implementation(libs.androidx.webkit)
  implementation(libs.youtubedl.library)
  implementation(libs.youtubedl.ffmpeg)
}
