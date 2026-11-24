# Building & Auto-Updating the Android APK

This Capacitor setup bundles `Leave_It_v101_Laptop_Fixed_d7f9ca8a.html` inside the Android `.apk` for 100% offline reliability **and** supports automatic Over-The-Air (OTA) live updates directly from your GitHub → Vercel deployment, so pushing code to GitHub updates the app inside the APK without reinstalling the APK every time.

## Included Android & Live-Sync Capabilities
- **GitHub → Vercel → APK Auto-Updates (Zero Reinstall)**:
  - Either set a GitHub Repository Variable named `LIVE_APP_URL` to your Vercel URL (e.g. `https://your-app.vercel.app`) before running the APK workflow, **OR** open **Manage → Live Auto-Update (GitHub → Vercel)** right inside the installed APK and paste your Vercel URL once.
  - Every `git push` deploys to Vercel and automatically loads inside the installed APK.
  - If the phone has no internet, `MainActivity` falls back seamlessly to the bundled offline copy inside the APK with the native Capacitor bridge intact.
- **Native Java App Blocker (Display Over Other Apps)**: `HourBlockerPlugin`, `HourBlockerAccessibilityService`, `HourBlockerForegroundService`, and `HourOverlayShield` detect distracting installed apps and draw a full-screen Focus Shield over other apps.
- **Strict Mode Exit & Close Lock**: Hardware Back button, Recents/App Switcher, Home escape attempts, and early session termination stay locked until the focus countdown completes (`SYSTEM_ALERT_WINDOW`, `PACKAGE_USAGE_STATS`, `BIND_ACCESSIBILITY_SERVICE`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, and optional `BIND_DEVICE_ADMIN`).
- **Reliable WebView Exports**: JSON backups, CSV exports, `.ics` calendar files, and PNG share cards fall back cleanly to Android's native Share sheet or Clipboard if WebView blocks `blob:` downloads.

---

## Option 1: Automatic Cloud APK Build + Auto-Updates (Recommended)
1. Deploy your GitHub repo on **Vercel** as usual so every push to `main` updates your live URL (e.g. `https://your-app.vercel.app`).
2. In your GitHub repository: **Settings → Secrets and variables → Actions → Variables → New repository variable** → add `LIVE_APP_URL` = `https://your-app.vercel.app`.
3. Open the **Actions** tab on GitHub and run **Build Android APK** once. Download `Leave-It-Timer-debug.apk` and install it on your phone.
4. From then on, **every `git push` automatically reflects in both Vercel and your installed APK** — no need to rebuild or reinstall the APK unless you modify native Java code in `native/android/` or `AndroidManifest.xml`.

*(Already built the APK without `LIVE_APP_URL`? Open the APK → Settings/Regain → **App Blocker → Live Auto-Update**, paste your Vercel URL, and tap **Save & Sync Vercel** once.)*

---

## Option 2: Build Locally on Your Laptop
Prerequisites: **Node.js 20+**, **Java JDK 21**, and **Android Studio** (Android SDK).

```bash
npm install
# Optional: set LIVE_APP_URL=https://your-app.vercel.app to bake live updates in
npm run apk:prepare
npx cap add android
npm run apk:sync
```

Then either:
- Open Android Studio with `npx cap open android` and click **Build → Build Bundle(s) / APK(s) → Build APK(s)**, **or**
- Build from terminal:
  ```bash
  cd android
  ./gradlew assembleDebug
  ```
  The APK will be generated at `android/app/build/outputs/apk/debug/app-debug.apk`.

