package com.atul.leaveittimer.blocker;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class HourStrictBootReceiver extends BroadcastReceiver {

    public static final String ACTION_RESTORE_STRICT = "com.atul.leaveittimer.ACTION_RESTORE_STRICT";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!HourBlockerState.isSessionActive(context)) {
            return;
        }
        HourBlockerForegroundService.startOrUpdate(context);
        if (HourBlockerState.isStrictLockActive(context)) {
            HourBlockerState.bringAppToFront(context);
        }
    }
}
