import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const nativeDir = path.join(root, 'native', 'android');
const androidMainDir = path.join(root, 'android', 'app', 'src', 'main');
const manifestPath = path.join(androidMainDir, 'AndroidManifest.xml');

if (!fs.existsSync(androidMainDir) || !fs.existsSync(manifestPath)) {
  console.log('Android project not generated yet (run `npx cap add android` first). Skipping native overlay.');
  process.exit(0);
}

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, {recursive: true});
  for (const entry of fs.readdirSync(src, {withFileTypes: true})) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 1. Copy native Java classes & XML resources into Android project
copyDirRecursive(path.join(nativeDir, 'java'), path.join(androidMainDir, 'java'));
copyDirRecursive(path.join(nativeDir, 'res'), path.join(androidMainDir, 'res'));

// 2. Patch AndroidManifest.xml idempotently
let manifest = fs.readFileSync(manifestPath, 'utf8');

if (!manifest.includes('xmlns:tools=')) {
  manifest = manifest.replace(
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android"',
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android"\n    xmlns:tools="http://schemas.android.com/tools"'
  );
}

const permissions = [
  {name: 'android.permission.WAKE_LOCK', tag: '<uses-permission android:name="android.permission.WAKE_LOCK" />'},
  {name: 'android.permission.VIBRATE', tag: '<uses-permission android:name="android.permission.VIBRATE" />'},
  {name: 'android.permission.SYSTEM_ALERT_WINDOW', tag: '<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" />'},
  {
    name: 'android.permission.PACKAGE_USAGE_STATS',
    tag: '<uses-permission android:name="android.permission.PACKAGE_USAGE_STATS" tools:ignore="ProtectedPermissions" />',
  },
  {name: 'android.permission.FOREGROUND_SERVICE', tag: '<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />'},
  {
    name: 'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
    tag: '<uses-permission android:name="android.permission.FOREGROUND_SERVICE_SPECIAL_USE" />',
  },
  {name: 'android.permission.POST_NOTIFICATIONS', tag: '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />'},
  {name: 'android.permission.REORDER_TASKS', tag: '<uses-permission android:name="android.permission.REORDER_TASKS" />'},
  {name: 'android.permission.RECEIVE_BOOT_COMPLETED', tag: '<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />'},
  {
    name: 'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
    tag: '<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />',
  },
  {name: 'android.permission.SCHEDULE_EXACT_ALARM', tag: '<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />'},
  {
    name: 'android.permission.QUERY_ALL_PACKAGES',
    tag: '<uses-permission android:name="android.permission.QUERY_ALL_PACKAGES" tools:ignore="QueryAllPackagesPermission" />',
  },
];

const missingPerms = permissions
  .filter((p) => !manifest.includes(`android:name="${p.name}"`))
  .map((p) => `    ${p.tag}`)
  .join('\n');

if (missingPerms) {
  manifest = manifest.replace('<application', `${missingPerms}\n\n    <application`);
}

if (!manifest.includes('android.intent.category.LAUNCHER') || !manifest.includes('<queries>')) {
  const queriesBlock = `    <queries>
        <intent>
            <action android:name="android.intent.action.MAIN" />
            <category android:name="android.intent.category.LAUNCHER" />
        </intent>
    </queries>\n\n`;
  if (!manifest.includes('<queries>')) {
    manifest = manifest.replace('<application', `${queriesBlock}    <application`);
  }
}

const componentsMarker = '<!-- Hour Native App Blocker Services & Receivers -->';
if (!manifest.includes(componentsMarker)) {
  const componentsBlock = `
        ${componentsMarker}
        <service
            android:name=".blocker.HourBlockerForegroundService"
            android:enabled="true"
            android:exported="false"
            android:foregroundServiceType="specialUse"
            android:stopWithTask="false">
            <property
                android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"
                android:value="Enforces user-configured app blocking overlay and strict focus session lock" />
        </service>

        <service
            android:name=".blocker.HourBlockerAccessibilityService"
            android:exported="true"
            android:label="Hour Focus App Blocker"
            android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE">
            <intent-filter>
                <action android:name="android.accessibilityservice.AccessibilityService" />
            </intent-filter>
            <meta-data
                android:name="android.accessibilityservice"
                android:resource="@xml/hour_accessibility_service" />
        </service>

        <receiver
            android:name=".blocker.HourStrictBootReceiver"
            android:enabled="true"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED" />
                <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />
                <action android:name="com.atul.leaveittimer.ACTION_RESTORE_STRICT" />
            </intent-filter>
        </receiver>

        <receiver
            android:name=".blocker.HourDeviceAdminReceiver"
            android:description="@string/hour_device_admin_description"
            android:exported="true"
            android:label="@string/hour_device_admin_label"
            android:permission="android.permission.BIND_DEVICE_ADMIN">
            <meta-data
                android:name="android.app.device_admin"
                android:resource="@xml/hour_device_admin" />
            <intent-filter>
                <action android:name="android.app.action.DEVICE_ADMIN_ENABLED" />
            </intent-filter>
        </receiver>
    </application>`;

  manifest = manifest.replace('    </application>', componentsBlock);
}

fs.writeFileSync(manifestPath, manifest, 'utf8');

// 3. Ensure required AndroidX dependencies (androidx.webkit, core, activity) are present in app/build.gradle
const appGradlePath = path.join(root, 'android', 'app', 'build.gradle');
if (fs.existsSync(appGradlePath)) {
  let gradle = fs.readFileSync(appGradlePath, 'utf8');
  const requiredDeps = [
    'implementation "androidx.webkit:webkit:$androidxWebkitVersion"',
    'implementation "androidx.core:core:$androidxCoreVersion"',
    'implementation "androidx.activity:activity:$androidxActivityVersion"',
  ];
  const missingDeps = requiredDeps.filter((dep) => !gradle.includes(dep));
  if (missingDeps.length > 0 && gradle.includes("implementation project(':capacitor-android')")) {
    gradle = gradle.replace(
      "implementation project(':capacitor-android')",
      `implementation project(':capacitor-android')\n    ${missingDeps.join('\n    ')}`
    );
    fs.writeFileSync(appGradlePath, gradle, 'utf8');
  }
}

console.log('Applied native Java App Blocker, OTA dependencies & Strict Mode components to android/.');
