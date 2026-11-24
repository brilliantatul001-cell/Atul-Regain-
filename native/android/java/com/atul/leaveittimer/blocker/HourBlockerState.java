package com.atul.leaveittimer.blocker;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.view.inputmethod.InputMethodInfo;
import android.view.inputmethod.InputMethodManager;

import com.atul.leaveittimer.MainActivity;

import org.json.JSONObject;

import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

public final class HourBlockerState {

    private static final String PREFS = "hour_native_blocker_prefs";
    private static final String KEY_ACTIVE = "session_active";
    private static final String KEY_STRICT = "strict_mode";
    private static final String KEY_PAUSED = "session_paused";
    private static final String KEY_ENDS_AT = "ends_at_ms";
    private static final String KEY_DURATION_SEC = "duration_sec";
    private static final String KEY_TASK_TITLE = "task_title";
    private static final String KEY_PACKAGES = "blocked_packages";
    private static final String KEY_NAMES_JSON = "blocked_names_json";
    private static final String KEY_ALLOW_SETTINGS_UNTIL = "allow_settings_until_ms";
    private static final String KEY_LIVE_SERVER_URL = "live_server_url";
    private static final String KEY_LIVE_SERVER_MODE = "live_server_mode";

    private HourBlockerState() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static synchronized void setBlockedPackages(Context ctx, Set<String> pkgs, Map<String, String> names) {
        Set<String> clean = new HashSet<>();
        String self = ctx.getPackageName();
        if (pkgs != null) {
            for (String p : pkgs) {
                if (p != null) {
                    String trimmed = p.trim();
                    if (!trimmed.isEmpty() && !trimmed.equals(self)) {
                        clean.add(trimmed);
                    }
                }
            }
        }
        JSONObject obj = new JSONObject();
        if (names != null) {
            for (Map.Entry<String, String> entry : names.entrySet()) {
                try {
                    if (entry.getKey() != null && entry.getValue() != null) {
                        obj.put(entry.getKey(), entry.getValue());
                    }
                } catch (Exception ignored) {
                }
            }
        }
        prefs(ctx).edit()
            .putStringSet(KEY_PACKAGES, clean)
            .putString(KEY_NAMES_JSON, obj.toString())
            .apply();
    }

    public static synchronized Set<String> getBlockedPackages(Context ctx) {
        Set<String> raw = prefs(ctx).getStringSet(KEY_PACKAGES, Collections.emptySet());
        return raw == null ? Collections.emptySet() : new HashSet<>(raw);
    }

    public static synchronized Map<String, String> getBlockedNames(Context ctx) {
        Map<String, String> out = new HashMap<>();
        String raw = prefs(ctx).getString(KEY_NAMES_JSON, "{}");
        try {
            JSONObject obj = new JSONObject(raw);
            Iterator<String> keys = obj.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                out.put(k, obj.optString(k, k));
            }
        } catch (Exception ignored) {
        }
        return out;
    }

    public static String getAppDisplayName(Context ctx, String pkg) {
        if (pkg == null || pkg.isEmpty()) return "Blocked app";
        Map<String, String> cached = getBlockedNames(ctx);
        if (cached.containsKey(pkg)) return cached.get(pkg);
        try {
            PackageManager pm = ctx.getPackageManager();
            CharSequence label = pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0));
            if (label != null && label.length() > 0) return label.toString();
        } catch (Exception ignored) {
        }
        return pkg;
    }

    public static synchronized void startSession(
        Context ctx,
        long endsAtMs,
        int durationSec,
        boolean strictMode,
        String taskTitle,
        Set<String> pkgs,
        Map<String, String> names
    ) {
        long now = System.currentTimeMillis();
        long safeEnds = endsAtMs > now
            ? endsAtMs
            : now + Math.max(60L, Math.min(180L * 60L, durationSec > 0 ? durationSec : 1500L)) * 1000L;

        SharedPreferences.Editor ed = prefs(ctx).edit()
            .putBoolean(KEY_ACTIVE, true)
            .putBoolean(KEY_STRICT, strictMode)
            .putBoolean(KEY_PAUSED, false)
            .putLong(KEY_ENDS_AT, safeEnds)
            .putInt(KEY_DURATION_SEC, Math.max(60, durationSec))
            .putString(KEY_TASK_TITLE, taskTitle == null ? "" : taskTitle.trim())
            .putLong(KEY_ALLOW_SETTINGS_UNTIL, 0L);

        if (pkgs != null) {
            setBlockedPackages(ctx, pkgs, names);
        }
        ed.apply();
    }

    public static synchronized void updateSession(
        Context ctx,
        long endsAtMs,
        boolean strictMode,
        boolean paused,
        String taskTitle
    ) {
        SharedPreferences p = prefs(ctx);
        boolean wasStrictActive = isStrictLockActive(ctx);
        boolean finalStrict = wasStrictActive || strictMode;
        long existingEnd = p.getLong(KEY_ENDS_AT, 0L);
        long finalEnd = (wasStrictActive && endsAtMs < existingEnd) ? existingEnd : endsAtMs;
        boolean finalPaused = wasStrictActive ? false : paused;

        p.edit()
            .putBoolean(KEY_STRICT, finalStrict)
            .putBoolean(KEY_PAUSED, finalPaused)
            .putLong(KEY_ENDS_AT, finalEnd)
            .putString(KEY_TASK_TITLE, taskTitle == null ? p.getString(KEY_TASK_TITLE, "") : taskTitle.trim())
            .apply();
    }

    public static synchronized boolean stopSession(Context ctx, boolean forceCompleted) {
        if (!forceCompleted && isStrictLockActive(ctx)) {
            return false;
        }
        prefs(ctx).edit()
            .putBoolean(KEY_ACTIVE, false)
            .putBoolean(KEY_STRICT, false)
            .putBoolean(KEY_PAUSED, false)
            .putLong(KEY_ENDS_AT, 0L)
            .putString(KEY_TASK_TITLE, "")
            .putLong(KEY_ALLOW_SETTINGS_UNTIL, 0L)
            .apply();
        return true;
    }

    public static synchronized void allowTemporarySettingsHop(Context ctx, long durationMs) {
        if (isStrictLockActive(ctx)) return;
        prefs(ctx).edit().putLong(KEY_ALLOW_SETTINGS_UNTIL, System.currentTimeMillis() + durationMs).apply();
    }

    public static synchronized boolean isTemporarySettingsAllowed(Context ctx) {
        return System.currentTimeMillis() < prefs(ctx).getLong(KEY_ALLOW_SETTINGS_UNTIL, 0L);
    }

    public static synchronized boolean isSessionActive(Context ctx) {
        SharedPreferences p = prefs(ctx);
        if (!p.getBoolean(KEY_ACTIVE, false)) return false;
        long endsAt = p.getLong(KEY_ENDS_AT, 0L);
        if (endsAt > 0L && System.currentTimeMillis() >= endsAt) {
            stopSession(ctx, true);
            return false;
        }
        return true;
    }

    public static synchronized boolean isStrictLockActive(Context ctx) {
        if (!isSessionActive(ctx)) return false;
        SharedPreferences p = prefs(ctx);
        return p.getBoolean(KEY_STRICT, false) && !p.getBoolean(KEY_PAUSED, false);
    }

    public static synchronized long getEndsAtMs(Context ctx) {
        return prefs(ctx).getLong(KEY_ENDS_AT, 0L);
    }

    public static synchronized int getRemainingSec(Context ctx) {
        long endsAt = getEndsAtMs(ctx);
        if (endsAt <= 0L) return 0;
        return (int) Math.max(0L, (endsAt - System.currentTimeMillis() + 999L) / 1000L);
    }

    public static synchronized String getTaskTitle(Context ctx) {
        return prefs(ctx).getString(KEY_TASK_TITLE, "");
    }

    public static synchronized boolean isPaused(Context ctx) {
        return prefs(ctx).getBoolean(KEY_PAUSED, false);
    }

    public static synchronized int getDurationSec(Context ctx) {
        return prefs(ctx).getInt(KEY_DURATION_SEC, 1500);
    }

    public static String formatRemaining(Context ctx) {
        int sec = getRemainingSec(ctx);
        int mins = sec / 60;
        int rem = sec % 60;
        return String.format(Locale.US, "%02d:%02d", mins, rem);
    }

    public static boolean isEssentialSystemOrIme(Context ctx, String pkg) {
        if (pkg == null || pkg.isEmpty()) return true;
        if (pkg.equals(ctx.getPackageName())) return true;
        if (
            pkg.equals("com.android.incallui") ||
            pkg.equals("com.google.android.dialer") ||
            pkg.equals("com.android.dialer") ||
            pkg.equals("com.samsung.android.incallui") ||
            pkg.equals("com.android.phone") ||
            pkg.equals("com.android.server.telecom") ||
            pkg.equals("com.android.emergency")
        ) {
            return true;
        }
        try {
            InputMethodManager imm = (InputMethodManager) ctx.getSystemService(Context.INPUT_METHOD_SERVICE);
            if (imm != null) {
                List<InputMethodInfo> imes = imm.getEnabledInputMethodList();
                for (InputMethodInfo info : imes) {
                    if (pkg.equals(info.getPackageName())) return true;
                }
            }
        } catch (Exception ignored) {
        }
        return false;
    }

    public static synchronized String getLiveServerMode(Context ctx) {
        return prefs(ctx).getString(KEY_LIVE_SERVER_MODE, "");
    }

    public static synchronized String getLiveServerUrl(Context ctx) {
        return prefs(ctx).getString(KEY_LIVE_SERVER_URL, "");
    }

    public static synchronized String setLiveServerConfig(Context ctx, String rawUrl, String mode) {
        String cleanMode = mode == null ? "" : mode.trim().toLowerCase(Locale.US);
        String normalized = normalizeLiveUrl(rawUrl);
        if ("offline".equals(cleanMode)) {
            prefs(ctx).edit()
                .putString(KEY_LIVE_SERVER_MODE, "offline")
                .apply();
            return "";
        }
        if ("auto".equals(cleanMode) || normalized.isEmpty()) {
            prefs(ctx).edit()
                .remove(KEY_LIVE_SERVER_MODE)
                .remove(KEY_LIVE_SERVER_URL)
                .apply();
            return "";
        }
        prefs(ctx).edit()
            .putString(KEY_LIVE_SERVER_MODE, "custom")
            .putString(KEY_LIVE_SERVER_URL, normalized)
            .apply();
        return normalized;
    }

    public static String normalizeLiveUrl(String rawUrl) {
        if (rawUrl == null) return "";
        String trimmed = rawUrl.trim();
        if (trimmed.isEmpty()) return "";
        if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
            trimmed = "https://" + trimmed;
        }
        while (trimmed.endsWith("/")) {
            trimmed = trimmed.substring(0, trimmed.length() - 1);
        }
        try {
            Uri parsed = Uri.parse(trimmed);
            String scheme = parsed.getScheme();
            String host = parsed.getHost();
            if (scheme == null || host == null || host.isEmpty()) return "";
            if (!"https".equalsIgnoreCase(scheme) && !"http".equalsIgnoreCase(scheme)) return "";
            return parsed.toString();
        } catch (Exception ignored) {
            return "";
        }
    }

    public static void bringAppToFront(Context ctx) {
        try {
            Intent i = new Intent(ctx, MainActivity.class);
            i.addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK |
                Intent.FLAG_ACTIVITY_REORDER_TO_FRONT |
                Intent.FLAG_ACTIVITY_SINGLE_TOP
            );
            ctx.startActivity(i);
        } catch (Exception ignored) {
        }
    }
}
