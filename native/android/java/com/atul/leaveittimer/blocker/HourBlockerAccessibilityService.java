package com.atul.leaveittimer.blocker;

import android.accessibilityservice.AccessibilityService;
import android.view.accessibility.AccessibilityEvent;

import java.util.Set;

public class HourBlockerAccessibilityService extends AccessibilityService {

    private long lastEnforceAt = 0L;

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null) return;
        int type = event.getEventType();
        if (type != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED && type != AccessibilityEvent.TYPE_WINDOWS_CHANGED) {
            return;
        }
        CharSequence pkgCs = event.getPackageName();
        if (pkgCs == null) return;
        String pkg = pkgCs.toString();

        if (!HourBlockerState.isSessionActive(this)) {
            HourOverlayShield.hide(this);
            return;
        }

        if (pkg.equals(getPackageName())) {
            HourOverlayShield.hide(this);
            return;
        }

        if (HourBlockerState.isEssentialSystemOrIme(this, pkg)) {
            return;
        }

        Set<String> blocked = HourBlockerState.getBlockedPackages(this);
        boolean isBlockedApp = blocked.contains(pkg);
        boolean isStrict = HourBlockerState.isStrictLockActive(this);

        if (!isBlockedApp && !isStrict) {
            return;
        }

        long now = System.currentTimeMillis();
        if (now - lastEnforceAt < 180L) return;
        lastEnforceAt = now;

        if (isBlockedApp) {
            String appName = HourBlockerState.getAppDisplayName(this, pkg);
            HourOverlayShield.show(
                this,
                "🚫 " + appName + " is blocked",
                isStrict
                    ? "Strict Mode is ON. Finish your session before opening distracting apps."
                    : "Blocked by your Hour focus shield. Get back to work!"
            );
            HourBlockerPlugin.emitStrictEvent("blockedAppIntercepted", pkg);
            performGlobalAction(GLOBAL_ACTION_HOME);
            HourBlockerState.bringAppToFront(this);
            return;
        }

        if (isStrict) {
            if ("com.android.systemui".equals(pkg)) {
                // Allow brief notification shade glance unless user enters recents or leaves Hour
                CharSequence cls = event.getClassName();
                String clsName = cls == null ? "" : cls.toString();
                if (!clsName.contains("Recents") && !clsName.contains("Overview")) {
                    return;
                }
            }
            HourOverlayShield.show(
                this,
                "🔒 Strict Mode Locked",
                "Exiting Hour, opening Settings, or switching apps is blocked until the timer finishes."
            );
            HourBlockerPlugin.emitStrictEvent("strictExitBlocked", pkg);
            HourBlockerState.bringAppToFront(this);
        }
    }

    @Override
    public void onInterrupt() {}
}
