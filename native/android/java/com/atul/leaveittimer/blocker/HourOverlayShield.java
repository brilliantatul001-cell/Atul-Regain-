package com.atul.leaveittimer.blocker;

import android.content.Context;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

public final class HourOverlayShield {

    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static View overlayView = null;
    private static TextView titleView = null;
    private static TextView subtitleView = null;
    private static TextView timerView = null;
    private static TextView taskView = null;
    private static Runnable tickRunnable = null;

    private HourOverlayShield() {}

    public static boolean canDraw(Context ctx) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx);
    }

    public static void show(Context ctx, String headline, String subtitle) {
        MAIN.post(() -> showInternal(ctx.getApplicationContext(), headline, subtitle));
    }

    public static void hide(Context ctx) {
        MAIN.post(() -> hideInternal(ctx.getApplicationContext()));
    }

    private static int dp(Context ctx, int value) {
        return (int) TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value,
            ctx.getResources().getDisplayMetrics()
        );
    }

    private static void showInternal(Context ctx, String headline, String subtitle) {
        if (!canDraw(ctx)) {
            HourBlockerState.bringAppToFront(ctx);
            return;
        }
        WindowManager wm = (WindowManager) ctx.getSystemService(Context.WINDOW_SERVICE);
        if (wm == null) return;

        if (overlayView == null) {
            FrameLayout root = new FrameLayout(ctx);
            root.setBackgroundColor(Color.parseColor("#F5090D16"));
            root.setPadding(dp(ctx, 24), dp(ctx, 32), dp(ctx, 24), dp(ctx, 32));

            LinearLayout card = new LinearLayout(ctx);
            card.setOrientation(LinearLayout.VERTICAL);
            card.setGravity(Gravity.CENTER_HORIZONTAL);
            card.setPadding(dp(ctx, 24), dp(ctx, 28), dp(ctx, 24), dp(ctx, 28));
            GradientDrawable cardBg = new GradientDrawable();
            cardBg.setColor(Color.parseColor("#141928"));
            cardBg.setCornerRadius(dp(ctx, 26));
            cardBg.setStroke(dp(ctx, 1), Color.parseColor("#337ED957"));
            card.setBackground(cardBg);

            TextView badge = new TextView(ctx);
            badge.setText("🔒  HOUR FOCUS SHIELD");
            badge.setTextColor(Color.parseColor("#7ED957"));
            badge.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            badge.setTypeface(Typeface.DEFAULT_BOLD);
            badge.setPadding(dp(ctx, 14), dp(ctx, 6), dp(ctx, 14), dp(ctx, 6));
            GradientDrawable badgeBg = new GradientDrawable();
            badgeBg.setColor(Color.parseColor("#227ED957"));
            badgeBg.setCornerRadius(dp(ctx, 99));
            badge.setBackground(badgeBg);
            card.addView(badge);

            titleView = new TextView(ctx);
            titleView.setTextColor(Color.WHITE);
            titleView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 23);
            titleView.setTypeface(Typeface.DEFAULT_BOLD);
            titleView.setGravity(Gravity.CENTER);
            LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            );
            titleLp.topMargin = dp(ctx, 18);
            card.addView(titleView, titleLp);

            subtitleView = new TextView(ctx);
            subtitleView.setTextColor(Color.parseColor("#A5B1CC"));
            subtitleView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
            subtitleView.setGravity(Gravity.CENTER);
            LinearLayout.LayoutParams subLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            );
            subLp.topMargin = dp(ctx, 8);
            card.addView(subtitleView, subLp);

            timerView = new TextView(ctx);
            timerView.setTextColor(Color.parseColor("#7ED957"));
            timerView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 44);
            timerView.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
            timerView.setGravity(Gravity.CENTER);
            LinearLayout.LayoutParams timerLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            );
            timerLp.topMargin = dp(ctx, 20);
            card.addView(timerView, timerLp);

            taskView = new TextView(ctx);
            taskView.setTextColor(Color.parseColor("#DCE3F5"));
            taskView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
            taskView.setGravity(Gravity.CENTER);
            LinearLayout.LayoutParams taskLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            );
            taskLp.topMargin = dp(ctx, 6);
            card.addView(taskView, taskLp);

            Button backBtn = new Button(ctx);
            backBtn.setText("↩  Return to Hour Focus");
            backBtn.setAllCaps(false);
            backBtn.setTextColor(Color.parseColor("#071B0A"));
            backBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
            backBtn.setTypeface(Typeface.DEFAULT_BOLD);
            backBtn.setPadding(dp(ctx, 22), dp(ctx, 14), dp(ctx, 22), dp(ctx, 14));
            GradientDrawable btnBg = new GradientDrawable();
            btnBg.setColor(Color.parseColor("#7ED957"));
            btnBg.setCornerRadius(dp(ctx, 99));
            backBtn.setBackground(btnBg);
            LinearLayout.LayoutParams btnLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            );
            btnLp.topMargin = dp(ctx, 24);
            backBtn.setOnClickListener(v -> {
                HourBlockerState.bringAppToFront(ctx);
                hideInternal(ctx);
            });
            card.addView(backBtn, btnLp);

            FrameLayout.LayoutParams cardLp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER
            );
            root.addView(card, cardLp);

            int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;

            WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                type,
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN |
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
                PixelFormat.TRANSLUCENT
            );
            params.gravity = Gravity.CENTER;

            try {
                wm.addView(root, params);
                overlayView = root;
            } catch (Exception ignored) {
                overlayView = null;
                HourBlockerState.bringAppToFront(ctx);
                return;
            }
        }

        if (titleView != null) {
            titleView.setText(headline == null ? "Distraction Blocked" : headline);
        }
        if (subtitleView != null) {
            subtitleView.setText(subtitle == null ? "Stay locked into your Hour focus session." : subtitle);
        }
        String task = HourBlockerState.getTaskTitle(ctx);
        if (taskView != null) {
            if (task != null && !task.isEmpty()) {
                taskView.setVisibility(View.VISIBLE);
                taskView.setText("📋 " + task);
            } else {
                taskView.setVisibility(View.GONE);
            }
        }
        startTimerTicker(ctx);
    }

    private static void startTimerTicker(Context ctx) {
        if (tickRunnable != null) {
            MAIN.removeCallbacks(tickRunnable);
        }
        tickRunnable = new Runnable() {
            @Override
            public void run() {
                if (overlayView == null) return;
                if (!HourBlockerState.isSessionActive(ctx)) {
                    hideInternal(ctx);
                    return;
                }
                if (timerView != null) {
                    timerView.setText(HourBlockerState.formatRemaining(ctx));
                }
                MAIN.postDelayed(this, 500L);
            }
        };
        MAIN.post(tickRunnable);
    }

    private static void hideInternal(Context ctx) {
        if (tickRunnable != null) {
            MAIN.removeCallbacks(tickRunnable);
            tickRunnable = null;
        }
        if (overlayView != null) {
            try {
                WindowManager wm = (WindowManager) ctx.getSystemService(Context.WINDOW_SERVICE);
                if (wm != null) wm.removeViewImmediate(overlayView);
            } catch (Exception ignored) {
            }
            overlayView = null;
            titleView = null;
            subtitleView = null;
            timerView = null;
            taskView = null;
        }
    }
}
