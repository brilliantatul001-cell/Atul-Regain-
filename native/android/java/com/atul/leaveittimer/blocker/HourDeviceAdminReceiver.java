package com.atul.leaveittimer.blocker;

import android.app.admin.DeviceAdminReceiver;
import android.content.Context;
import android.content.Intent;

public class HourDeviceAdminReceiver extends DeviceAdminReceiver {

    @Override
    public CharSequence onDisableRequested(Context context, Intent intent) {
        if (HourBlockerState.isStrictLockActive(context)) {
            HourBlockerState.bringAppToFront(context);
            return "Strict Mode is active in Hour. Finish your focus session before disabling protection.";
        }
        return "Disable Hour uninstall protection?";
    }
}
