plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.hama.docviewer"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.hama.docviewer"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // 개인 설치용: 디버그 키로 서명 (스토어 배포 시 별도 키로 교체)
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    androidResources {
        // 압축하지 않아야 WebView에서 빠르게 로드됨
        noCompress += listOf("js", "bcmap", "pfb", "ttf")
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
}
