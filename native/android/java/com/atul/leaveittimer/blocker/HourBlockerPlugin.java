package com.atul.leaveittimer.blocker;

import android.Manifest;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.AppOpsManager;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.os.Process;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.Base64;
import android.view.accessibility.AccessibilityManager;

import androidx.core.app.NotificationManagerCompat;

import com.atul.leaveittimer.MainActivity;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(
    name = "HourBlocker",
    permissions = {
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications")
    }
)
public class HourBlockerPlugin extends Plugin {

    private static volatile WeakReference<HourBlockerPlugin> activeInstance = new WeakReference<>(null);
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override
    public void load() {
        super.load();
        activeInstance = new WeakReference<>(this);
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    public static void emitStrictEvent(String eventName, String detail) {
        HourBlockerPlugin plugin = activeInstance.get();
        if (plugin == null) return;
        try {
            JSObject data = new JSObject();
            data.put("detail", detail == null ? "" : detail);
            data.put("at", System.currentTimeMillis());
            plugin.notifyListeners(eventName, data);
        } catch (Exception ignored) {
        }
    }

    @PluginMethod
    public void getPermissionStatus(PluginCall call) {
        Context ctx = getContext();
        JSObject ret = new JSObject();
        ret.put("overlay", HourOverlayShield.canDraw(ctx));
        ret.put("usageStats", hasUsageStatsPermission(ctx));
        ret.put("accessibility", isAccessibilityEnabled(ctx));
        ret.put("batteryUnrestricted", isIgnoringBatteryOptimizations(ctx));
        ret.put("deviceAdmin", isDeviceAdminActive(ctx));
        ret.put("notifications", NotificationManagerCompat.from(ctx).areNotificationsEnabled());
        ret.put("strictLockActive", HourBlockerState.isStrictLockActive(ctx));
        ret.put("sessionActive", HourBlockerState.isSessionActive(ctx));
        ret.put("manufacturer", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER);
        ret.put("sdkInt", Build.VERSION.SDK_INT);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        String type = call.getString("type", "overlay");
        Context ctx = getContext();
        if (HourBlockerState.isStrictLockActive(ctx)) {
            call.reject("Strict Mode is active right now. Finish your session before changing permissions.");
            return;
        }
        HourBlockerState.allowTemporarySettingsHop(ctx, 45000L);
        try {
            Intent intent;
            switch (type) {
                case "overlay":
                    intent = new Intent(
                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:" + ctx.getPackageName())
                    );
                    break;
                case "usageStats":
                    intent = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
                    break;
                case "accessibility":
                    intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
                    break;
                case "battery":
                    intent = new Intent(
                        Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                        Uri.parse("package:" + ctx.getPackageName())
                    );
                    break;
                case "notifications":
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                        intent.putExtra(Settings.EXTRA_APP_PACKAGE, ctx.getPackageName());
                    } else {
                        intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + ctx.getPackageName()));
                    }
                    break;
                case "deviceAdmin":
                    ComponentName admin = new ComponentName(ctx, HourDeviceAdminReceiver.class);
                    intent = new Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN);
                    intent.putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, admin);
                    intent.putExtra(
                        DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                        "Prevents closing or force-uninstalling Hour while Strict Mode is active."
                    );
                    break;
                default:
                    intent = new Intent(
                        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.parse("package:" + ctx.getPackageName())
                    );
                    break;
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("opened", type);
            call.resolve(ret);
        } catch (Exception ex) {
            try {
                Intent fallback = new Intent(Settings.ACTION_SETTINGS);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(fallback);
                JSObject ret = new JSObject();
                ret.put("opened", "settings_fallback");
                call.resolve(ret);
            } catch (Exception ex2) {
                call.reject("Could not open system settings: " + ex2.getMessage());
            }
        }
    }

    @PluginMethod
    public void getInstalledApps(PluginCall call) {
        final boolean includeIcons = call.getBoolean("includeIcons", true);
        final Context ctx = getContext().getApplicationContext();
        executor.execute(() -> {
            try {
                PackageManager pm = ctx.getPackageManager();
                Intent mainIntent = new Intent(Intent.ACTION_MAIN, null);
                mainIntent.addCategory(Intent.CATEGORY_LAUNCHER);
                List<ResolveInfo> resolved = pm.queryIntentActivities(mainIntent, 0);

                String selfPkg = ctx.getPackageName();
                Set<String> seen = new HashSet<>();
                Set<String> selected = HourBlockerState.getBlockedPackages(ctx);
                List<JSObject> items = new ArrayList<>();

                for (ResolveInfo ri : resolved) {
                    if (ri.activityInfo == null) continue;
                    String pkg = ri.activityInfo.packageName;
                    if (pkg == null || pkg.equals(selfPkg) || seen.contains(pkg)) continue;
                    seen.add(pkg);

                    CharSequence labelCs = ri.loadLabel(pm);
                    String appName = labelCs != null ? labelCs.toString().trim() : pkg;
                    if (appName.isEmpty()) appName = pkg;

                    JSObject item = new JSObject();
                    item.put("packageName", pkg);
                    item.put("appName", appName);
                    item.put("blocked", selected.contains(pkg));
                    item.put("priority", priorityScore(pkg, appName));
                    if (includeIcons) {
                        item.put("icon", loadSmallIconBase64(ri.loadIcon(pm)));
                    }
                    items.add(item);
                }

                Collections.sort(items, new Comparator<JSObject>() {
                    @Override
                    public int compare(JSObject a, JSObject b) {
                        boolean ba = a.optBoolean("blocked", false);
                        boolean bb = b.optBoolean("blocked", false);
                        if (ba != bb) return ba ? -1 : 1;
                        int pa = a.optInt("priority", 0);
                        int pb = b.optInt("priority", 0);
                        if (pa != pb) return Integer.compare(pb, pa);
                        return a.optString("appName", "").compareToIgnoreCase(b.optString("appName", ""));
                    }
                });

                JSArray arr = new JSArray();
                for (JSObject it : items) arr.put(it);

                JSObject ret = new JSObject();
                ret.put("apps", arr);
                ret.put("count", items.size());
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Failed to list installed apps: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void setBlockedApps(PluginCall call) {
        Context ctx = getContext();
        JSArray pkgsArr = call.getArray("packages", new JSArray());
        JSObject namesObj = call.getObject("names", new JSObject());
        Set<String> pkgs = new HashSet<>();
        Map<String, String> names = new HashMap<>();

        for (int i = 0; i < pkgsArr.length(); i++) {
            try {
                String p = pkgsArr.getString(i);
                if (p != null && !p.trim().isEmpty()) {
                    pkgs.add(p.trim());
                }
            } catch (Exception ignored) {
            }
        }
        if (namesObj != null) {
            JSONArray keys = namesObj.names();
            if (keys != null) {
                for (int i = 0; i < keys.length(); i++) {
                    String k = keys.optString(i, "");
                    if (!k.isEmpty()) names.put(k, namesObj.optString(k, k));
                }
            }
        }

        HourBlockerState.setBlockedPackages(ctx, pkgs, names);
        if (HourBlockerState.isSessionActive(ctx)) {
            HourBlockerForegroundService.startOrUpdate(ctx);
        }

        JSObject ret = new JSObject();
        ret.put("savedCount", HourBlockerState.getBlockedPackages(ctx).size());
        call.resolve(ret);
    }

    @PluginMethod
    public void startFocusSession(PluginCall call) {
        Context ctx = getContext();
        int durationSec = readInt(call, "durationSec", 1500);
        long endsAtMs = readLong(call, "endsAtMs", System.currentTimeMillis() + Math.max(60L, durationSec) * 1000L);
        boolean strictMode = Boolean.TRUE.equals(call.getBoolean("strictMode", false));
        String taskTitle = call.getString("taskTitle", "");

        Set<String> pkgs = null;
        Map<String, String> names = null;
        if (call.hasOption("blockedPackages")) {
            JSArray arr = call.getArray("blockedPackages", new JSArray());
            pkgs = new HashSet<>();
            names = new HashMap<>();
            for (int i = 0; i < arr.length(); i++) {
                try {
                    Object item = arr.get(i);
                    if (item instanceof JSONObject) {
                        JSONObject o = (JSONObject) item;
                        String p = o.optString("packageName", "").trim();
                        String n = o.optString("appName", p).trim();
                        if (!p.isEmpty()) {
                            pkgs.add(p);
                            names.put(p, n.isEmpty() ? p : n);
                        }
                    } else if (item instanceof String) {
                        String p = ((String) item).trim();
                        if (!p.isEmpty()) pkgs.add(p);
                    }
                } catch (Exception ignored) {
                }
            }
        }

        HourBlockerState.startSession(ctx, endsAtMs, durationSec, strictMode, taskTitle, pkgs, names);
        HourBlockerForegroundService.startOrUpdate(ctx);

        if (getActivity() instanceof MainActivity) {
            final MainActivity act = (MainActivity) getActivity();
            act.runOnUiThread(() -> act.applyStrictWindowFlags(HourBlockerState.isStrictLockActive(ctx)));
        }

        JSObject ret = buildSessionStatus(ctx);
        call.resolve(ret);
    }

    @PluginMethod
    public void updateFocusSession(PluginCall call) {
        Context ctx = getContext();
        if (!HourBlockerState.isSessionActive(ctx)) {
            call.resolve(buildSessionStatus(ctx));
            return;
        }
        long endsAtMs = readLong(call, "endsAtMs", HourBlockerState.getEndsAtMs(ctx));
        boolean strictMode = Boolean.TRUE.equals(call.getBoolean("strictMode", HourBlockerState.isStrictLockActive(ctx)));
        boolean paused = Boolean.TRUE.equals(call.getBoolean("paused", HourBlockerState.isPaused(ctx)));
        String taskTitle = call.getString("taskTitle", HourBlockerState.getTaskTitle(ctx));

        HourBlockerState.updateSession(ctx, endsAtMs, strictMode, paused, taskTitle);
        HourBlockerForegroundService.startOrUpdate(ctx);

        if (getActivity() instanceof MainActivity) {
            final MainActivity act = (MainActivity) getActivity();
            act.runOnUiThread(() -> act.applyStrictWindowFlags(HourBlockerState.isStrictLockActive(ctx)));
        }
        call.resolve(buildSessionStatus(ctx));
    }

    private static long readLong(PluginCall call, String key, long def) {
        try {
            Object v = call.getData().opt(key);
            if (v instanceof Number) return ((Number) v).longValue();
            if (v instanceof String) return Long.parseLong(((String) v).trim());
        } catch (Exception ignored) {
        }
        return def;
    }

    private static int readInt(PluginCall call, String key, int def) {
        try {
            Object v = call.getData().opt(key);
            if (v instanceof Number) return ((Number) v).intValue();
            if (v instanceof String) return Integer.parseInt(((String) v).trim());
        } catch (Exception ignored) {
        }
        return def;
    }

    @PluginMethod
    public void stopFocusSession(PluginCall call) {
        Context ctx = getContext();
        boolean forceCompleted = Boolean.TRUE.equals(call.getBoolean("forceCompleted", false));
        long endsAt = HourBlockerState.getEndsAtMs(ctx);
        boolean naturallyExpired = endsAt <= 0L || System.currentTimeMillis() >= (endsAt - 2000L);
        boolean allowStop = !HourBlockerState.isStrictLockActive(ctx) || (forceCompleted && naturallyExpired);

        if (!allowStop) {
            JSObject blocked = buildSessionStatus(ctx);
            blocked.put("stopped", false);
            blocked.put("reason", "strict_lock_active");
            call.resolve(blocked);
            return;
        }

        HourBlockerState.stopSession(ctx, true);
        HourBlockerForegroundService.stopService(ctx);
        if (getActivity() instanceof MainActivity) {
            final MainActivity act = (MainActivity) getActivity();
            act.runOnUiThread(() -> act.applyStrictWindowFlags(false));
        }

        JSObject ret = buildSessionStatus(ctx);
        ret.put("stopped", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void getActiveSession(PluginCall call) {
        call.resolve(buildSessionStatus(getContext()));
    }

    @PluginMethod
    public void getLiveServerUrl(PluginCall call) {
        Context ctx = getContext();
        JSObject ret = new JSObject();
        ret.put("savedUrl", HourBlockerState.getLiveServerUrl(ctx));
        ret.put("mode", HourBlockerState.getLiveServerMode(ctx));
        String activeServerUrl = bridge != null && bridge.getServerUrl() != null ? bridge.getServerUrl() : "";
        String localUrl = bridge != null && bridge.getLocalUrl() != null ? bridge.getLocalUrl() : "https://localhost";
        ret.put("activeServerUrl", activeServerUrl);
        ret.put("localUrl", localUrl);
        if (bridge != null && bridge.getWebView() != null) {
            getActivity().runOnUiThread(() -> {
                String current = bridge.getWebView().getUrl();
                ret.put("currentUrl", current == null ? "" : current);
                call.resolve(ret);
            });
            return;
        }
        ret.put("currentUrl", "");
        call.resolve(ret);
    }

    @PluginMethod
    public void setLiveServerUrl(PluginCall call) {
        Context ctx = getContext();
        String url = call.getString("url", "");
        String mode = call.getString("mode", "");
        String saved = HourBlockerState.setLiveServerConfig(ctx, url, mode);
        String finalMode = HourBlockerState.getLiveServerMode(ctx);

        JSObject ret = new JSObject();
        ret.put("savedUrl", saved);
        ret.put("mode", finalMode);
        ret.put("reloading", true);
        call.resolve(ret);

        if (getActivity() instanceof MainActivity) {
            final MainActivity act = (MainActivity) getActivity();
            act.runOnUiThread(act::applyLiveServerAndReload);
        }
    }

    @PluginMethod
    public void reloadLiveApp(PluginCall call) {
        if (bridge == null || bridge.getWebView() == null) {
            call.reject("WebView not ready");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                bridge.getWebView().clearCache(false);
                if (getActivity() instanceof MainActivity) {
                    ((MainActivity) getActivity()).reloadActiveOrigin();
                } else {
                    bridge.reload();
                }
                JSObject ret = new JSObject();
                ret.put("reloaded", true);
                String u = bridge.getWebView().getUrl();
                ret.put("url", u == null ? "" : u);
                call.resolve(ret);
            } catch (Exception ex) {
                call.reject("Failed to reload: " + ex.getMessage());
            }
        });
    }

    private JSObject buildSessionStatus(Context ctx) {
        JSObject ret = new JSObject();
        boolean active = HourBlockerState.isSessionActive(ctx);
        boolean strict = HourBlockerState.isStrictLockActive(ctx);
        ret.put("sessionActive", active);
        ret.put("strictLockActive", strict);
        ret.put("strictMode", strict);
        ret.put("paused", HourBlockerState.isPaused(ctx));
        ret.put("endsAtMs", HourBlockerState.getEndsAtMs(ctx));
        ret.put("durationSec", HourBlockerState.getDurationSec(ctx));
        ret.put("remainingSec", HourBlockerState.getRemainingSec(ctx));
        ret.put("taskTitle", HourBlockerState.getTaskTitle(ctx));
        JSArray arr = new JSArray();
        for (String p : HourBlockerState.getBlockedPackages(ctx)) arr.put(p);
        ret.put("blockedPackages", arr);
        return ret;
    }

    private static boolean hasUsageStatsPermission(Context ctx) {
        try {
            AppOpsManager appOps = (AppOpsManager) ctx.getSystemService(Context.APP_OPS_SERVICE);
            if (appOps == null) return false;
            int mode;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                mode = appOps.unsafeCheckOpNoThrow(
                    AppOpsManager.OPSTR_GET_USAGE_STATS,
                    Process.myUid(),
                    ctx.getPackageName()
                );
            } else {
                mode = appOps.checkOpNoThrow(
                    AppOpsManager.OPSTR_GET_USAGE_STATS,
                    Process.myUid(),
                    ctx.getPackageName()
                );
            }
            return mode == AppOpsManager.MODE_ALLOWED;
        } catch (Exception ignored) {
            return false;
        }
    }

    private static boolean isAccessibilityEnabled(Context ctx) {
        try {
            AccessibilityManager am = (AccessibilityManager) ctx.getSystemService(Context.ACCESSIBILITY_SERVICE);
            if (am != null) {
                List<AccessibilityServiceInfo> list = am.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK);
                String targetId = ctx.getPackageName() + "/" + HourBlockerAccessibilityService.class.getName();
                String shortId = ctx.getPackageName() + "/.blocker." + HourBlockerAccessibilityService.class.getSimpleName();
                for (AccessibilityServiceInfo info : list) {
                    String id = info.getId();
                    if (id != null && (id.equals(targetId) || id.equals(shortId) || id.endsWith(HourBlockerAccessibilityService.class.getSimpleName()))) {
                        return true;
                    }
                }
            }
            String enabled = Settings.Secure.getString(ctx.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            if (!TextUtils.isEmpty(enabled)) {
                return enabled.contains(ctx.getPackageName() + "/" + HourBlockerAccessibilityService.class.getName())
                    || enabled.contains(HourBlockerAccessibilityService.class.getSimpleName());
            }
        } catch (Exception ignored) {
        }
        return false;
    }

    private static boolean isIgnoringBatteryOptimizations(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        try {
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            return pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
        } catch (Exception ignored) {
            return false;
        }
    }

    private static boolean isDeviceAdminActive(Context ctx) {
        try {
            DevicePolicyManager dpm = (DevicePolicyManager) ctx.getSystemService(Context.DEVICE_POLICY_SERVICE);
            if (dpm == null) return false;
            return dpm.isAdminActive(new ComponentName(ctx, HourDeviceAdminReceiver.class));
        } catch (Exception ignored) {
            return false;
        }
    }

    private static int priorityScore(String pkg, String name) {
        String low = (pkg + " " + name).toLowerCase(Locale.US);
        if (
            low.contains("instagram") ||
            low.contains("youtube") ||
            low.contains("musically") ||
            low.contains("tiktok") ||
            low.contains("snapchat") ||
            low.contains("facebook") ||
            low.contains("reddit") ||
            low.contains("twitter") ||
            low.contains("x.com") ||
            low.contains("netflix") ||
            low.contains("whatsapp") ||
            low.contains("telegram") ||
            low.contains("discord") ||
            low.contains("pubg") ||
            low.contains("bgmi") ||
            low.contains("freefire") ||
            low.contains("roblox") ||
            low.contains("hotstar") ||
            low.contains("primevideo") ||
            low.contains("spotify")
        ) {
            return 100;
        }
        if (low.contains("chrome") || low.contains("browser") || low.contains("game")) {
            return 50;
        }
        return 0;
    }

    private static String loadSmallIconBase64(Drawable drawable) {
        if (drawable == null) return "";
        try {
            int size = 64;
            Bitmap bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bmp);
            drawable.setBounds(0, 0, size, size);
            drawable.draw(canvas);
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            bmp.compress(Bitmap.CompressFormat.PNG, 85, baos);
            bmp.recycle();
            return "data:image/png;base64," + Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);
        } catch (Exception ignored) {
            return "";
        }
    }
}
