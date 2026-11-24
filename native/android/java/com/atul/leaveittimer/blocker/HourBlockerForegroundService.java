package com.atul.leaveittimer.blocker;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;

import androidx.core.app.NotificationCompat;

import com.atul.leaveittimer.MainActivity;

import java.util.Set;

public class HourBlockerForegroundService extends Service {

    private static final String CHANNEL_ID = "hour_focus_shield_channel";
    private static final int NOTIF_ID = 7071;
    private static final long POLL_MS = 650L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean loopRunning = false;
    private String lastDetectedForegroundPkg = "";

    public static void startOrUpdate(Context ctx) {
        if (!HourBlockerState.isSessionActive(ctx)) return;
        Intent intent = new Intent(ctx, HourBlockerForegroundService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(intent);
        } else {
            ctx.startService(intent);
        }
    }

    public static void stopService(Context ctx) {
        HourOverlayShield.hide(ctx);
        try {
            ctx.stopService(new Intent(ctx, HourBlockerForegroundService.class));
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        ensureNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!HourBlockerState.isSessionActive(this)) {
            HourOverlayShield.hide(this);
            stopSelf();
            return START_NOT_STICKY;
        }
        Notification notif = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIF_ID, notif);
        }
        if (!loopRunning) {
            loopRunning = true;
            handler.post(watchdogTick);
        }
        return START_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        if (!HourBlockerState.isStrictLockActive(this)) {
            return;
        }
        // User swiped / closed app from Recents during Strict Mode -> immediately restore
        Intent restart = new Intent(this, HourStrictBootReceiver.class);
        restart.setAction(HourStrictBootReceiver.ACTION_RESTORE_STRICT);
        PendingIntent pi = PendingIntent.getBroadcast(
            this,
            9012,
            restart,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
        if (am != null) {
            long triggerAt = SystemClock.elapsedRealtime() + 250L;
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !am.canScheduleExactAlarms()) {
                    am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi);
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi);
                } else {
                    am.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi);
                }
            } catch (Exception ignored) {
            }
        }
        HourOverlayShield.show(
            this,
            "🔒 Strict Mode Active",
            "App closing blocked while your timer is still running."
        );
        HourBlockerState.bringAppToFront(this);
    }

    @Override
    public void onDestroy() {
        loopRunning = false;
        handler.removeCallbacks(watchdogTick);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private final Runnable watchdogTick = new Runnable() {
        @Override
        public void run() {
            if (!HourBlockerState.isSessionActive(HourBlockerForegroundService.this)) {
                HourOverlayShield.hide(HourBlockerForegroundService.this);
                stopSelf();
                return;
            }
            updateNotification();
            inspectForegroundApp();
            handler.postDelayed(this, POLL_MS);
        }
    };

    private void inspectForegroundApp() {
        String fg = queryForegroundPackage();
        if (fg == null || fg.isEmpty()) return;

        if (fg.equals(getPackageName())) {
            HourOverlayShield.hide(this);
            return;
        }
        if (HourBlockerState.isEssentialSystemOrIme(this, fg)) {
            return;
        }

        Set<String> blocked = HourBlockerState.getBlockedPackages(this);
        boolean isBlocked = blocked.contains(fg);
        boolean strict = HourBlockerState.isStrictLockActive(this);

        if (isBlocked) {
            String appName = HourBlockerState.getAppDisplayName(this, fg);
            HourOverlayShield.show(
                this,
                "🚫 " + appName + " is blocked",
                strict
                    ? "Strict Mode is ON. Finish your session before using distracting apps."
                    : "Distracting app blocked by Hour."
            );
            HourBlockerState.bringAppToFront(this);
        } else if (strict && !"com.android.systemui".equals(fg)) {
            HourOverlayShield.show(
                this,
                "🔒 Strict Mode Locked",
                "Stay inside Hour until your focus countdown reaches 00:00."
            );
            HourBlockerState.bringAppToFront(this);
        }
    }

    private String queryForegroundPackage() {
        try {
            UsageStatsManager usm = (UsageStatsManager) getSystemService(Context.USAGE_STATS_SERVICE);
            if (usm == null) return lastDetectedForegroundPkg;
            long end = System.currentTimeMillis();
            long begin = end - 4000L;
            UsageEvents events = usm.queryEvents(begin, end);
            if (events == null) return lastDetectedForegroundPkg;
            UsageEvents.Event ev = new UsageEvents.Event();
            String latest = lastDetectedForegroundPkg;
            long latestTs = 0L;
            while (events.hasNextEvent()) {
                events.getNextEvent(ev);
                int type = ev.getEventType();
                if (type == UsageEvents.Event.ACTIVITY_RESUMED || type == UsageEvents.Event.MOVE_TO_FOREGROUND) {
                    if (ev.getTimeStamp() >= latestTs && ev.getPackageName() != null) {
                        latestTs = ev.getTimeStamp();
                        latest = ev.getPackageName();
                    }
                }
            }
            lastDetectedForegroundPkg = latest;
            return latest;
        } catch (Exception ignored) {
            return lastDetectedForegroundPkg;
        }
    }

    private void ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID,
                "Hour Focus Shield",
                NotificationManager.IMPORTANCE_LOW
            );
            ch.setDescription("Keeps app blocker & Strict Mode shield active during focus sessions.");
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    private Notification buildNotification() {
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        PendingIntent pi = PendingIntent.getActivity(
            this,
            101,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        boolean strict = HourBlockerState.isStrictLockActive(this);
        int blockedCount = HourBlockerState.getBlockedPackages(this).size();
        String timeLeft = HourBlockerState.formatRemaining(this);
        String title = strict
            ? "🔒 Strict Focus Locked · " + timeLeft + " left"
            : "🛡 Hour Focus Shield · " + timeLeft + " left";
        String body = blockedCount > 0
            ? "Blocking " + blockedCount + " app" + (blockedCount == 1 ? "" : "s") + (strict ? " · Exit disabled" : "")
            : (strict ? "Exit & app closing locked until completion" : "Focus session active");

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_idle_lock)
            .setContentTitle(title)
            .setContentText(body)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(pi)
            .build();
    }

    private void updateNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(NOTIF_ID, buildNotification());
        }
    }
}
