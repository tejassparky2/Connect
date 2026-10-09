# Android test APK (sideload)

A **test build** you can install directly on an Android phone. It does not contain a server address: on first launch you point it at a Mohalla Connect API running on your own computer (same Wi-Fi). Store builds are different — they bake in an HTTPS `EXPO_PUBLIC_API_URL` and never show the server setting.

## Install and use

1. On your computer, start the database and API (see the README quick start). Then find the computer's Wi-Fi IP: `ipconfig` (Windows) or `ipconfig getifaddr en0` (macOS).
2. Copy `app-release.apk` to the phone and open it. Android will ask to allow installs from that source (Files / Chrome) — allow it. Play Protect may warn about an unknown developer; choose **Install anyway** (the APK is signed with a debug key, as test builds are).
3. Open **Mohalla Connect** → on the welcome screen tap **Server: … · Change** → enter `<computer-IP>:4000` → **Test & save**. The app checks `/health` before saving.
4. Log in with a demo number (e.g. `99000 00002`); in dev mode the OTP is shown on screen.

If **Test & save** can't reach the server: confirm both devices are on the same Wi-Fi, the API is running, and port 4000 is allowed through the computer's firewall. Guest / office Wi-Fi often blocks device-to-device traffic — use a phone hotspot instead.

Not in this build: push notifications (need `eas init` + FCM credentials) and live Razorpay/SMS (need real keys on the API).

## Rebuild it

Requirements: Node 22, JDK 17 or 21, Android SDK with `platforms;android-36`, `build-tools;36.0.0`, `ndk;27.1.12297006`, `cmake;3.22.1` (versions come from `node_modules/react-native/gradle/libs.versions.toml`).

```bash
cd apps/mobile
npm ci
# MOHALLA_TEST_BUILD=1 allows cleartext HTTP to a LAN API; do NOT set EXPO_PUBLIC_API_URL for a test build
CI=1 MOHALLA_TEST_BUILD=1 npx expo prebuild --platform android --clean
cd android
# optional, faster: only build for real phones
echo "reactNativeArchitectures=arm64-v8a,armeabi-v7a" >> gradle.properties
ANDROID_HOME=/path/to/android-sdk ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk
```

`android/` is generated (git-ignored). The release variant is signed with the debug keystore, which is fine for sideloading but **not** for the Play Store — for that, use `npx eas-cli build --platform android` with a proper upload key and an HTTPS `EXPO_PUBLIC_API_URL`.

If Gradle fails with HTTP 429 from `repo.maven.apache.org` (Maven Central rate-limits shared CI/cloud IPs), use the init script that redirects it to Google's official mirror:

```bash
./gradlew assembleRelease -I ../tools/central-mirror.init.gradle \
  -Dorg.gradle.internal.repository.max.retries=10 -Dorg.gradle.internal.repository.initial.backoff=2000
```
