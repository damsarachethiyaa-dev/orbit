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
    versionCode = 102
    versionName = "1.0.2"

    ndk {
      abiFilters += listOf("arm64-v8a", "armeabi-v7a")
    }
  }

  signingConfigs {
    create("release") {
      storeFile = file("orbit-release.jks")
      storePassword = "orbitrelease2026"
      keyAlias = "orbit"
      keyPassword = "orbitrelease2026"
      enableV1Signing = true
      enableV2Signing = true
      enableV3Signing = true
    }
  }

  buildTypes {
    debug {
      signingConfig = signingConfigs.getByName("release")
    }
    release {
      isMinifyEnabled = false
      signingConfig = signingConfigs.getByName("release")
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
