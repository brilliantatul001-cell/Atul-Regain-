# Building the Offline Android APK

Unlike Median (which wraps a live hosted URL), this Capacitor setup bundles `Leave_It_v101_Laptop_Fixed_d7f9ca8a.html` directly inside the Android `.apk` so every timer, sound, focus overlay, mock tracker, and backup works **100% offline** with no internet connection required.

## Included Android & WebView Enhancements
- **Hardware Back Button Support**: Pressing Android Back closes open modals (`History`, `Sheet`, `Tests`, `Planner`, `Focus Mode`, etc.) before asking to exit.
- **Reliable WebView Exports**: JSON backups, CSV exports, `.ics` calendar files, and PNG share cards fall back cleanly to Android's native Share sheet or Clipboard if WebView blocks `blob:` downloads.
- **App Permissions**: Configured for `WAKE_LOCK` (keeps screen awake during focus/question timers) and `VIBRATE`.

---

## Option 1: Automatic Cloud APK Build (No Android Studio Needed)
1. Push this project to a GitHub repository (`main` or `master` branch).
2. Open the **Actions** tab on GitHub and select **Build Android APK** (or trigger **Run workflow** manually).
3. Once finished, download the `Leave-It-Timer-debug.apk` artifact and install it on your phone.

---

## Option 2: Build Locally on Your Laptop
Prerequisites: **Node.js 20+**, **Java JDK 21**, and **Android Studio** (Android SDK).

```bash
npm install
npm run apk:prepare
npx cap add android
npx cap sync android
```

Then either:
- Open Android Studio with `npx cap open android` and click **Build → Build Bundle(s) / APK(s) → Build APK(s)**, **or**
- Build from terminal:
  ```bash
  cd android
  ./gradlew assembleDebug
  ```
  The APK will be generated at `android/app/build/outputs/apk/debug/app-debug.apk`.

---

## Updating the App After Future Edits
Whenever we edit `/public/assets/aistudio/Leave_It_v101_Laptop_Fixed_d7f9ca8a.html`:
- The AI Studio live web app & PWA update immediately.
- For the Android APK, run `npm run apk:sync` (locally) or push to GitHub to generate an updated `.apk`.
