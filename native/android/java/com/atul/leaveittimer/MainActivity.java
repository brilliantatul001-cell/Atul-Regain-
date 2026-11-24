package com.atul.leaveittimer;

import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.WindowManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.atul.leaveittimer.blocker.HourBlockerForegroundService;
import com.atul.leaveittimer.blocker.HourBlockerPlugin;
import com.atul.leaveittimer.blocker.HourBlockerState;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.CapConfig;
import com.getcapacitor.JSExport;
import com.getcapacitor.PluginHandle;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

public class MainActivity extends BridgeActivity {

    private final Handler strictHandler = new Handler(Looper.getMainLooper());
    private long lastStrictToastAt = 0L;
    private boolean isReloadingConfig = false;
    private boolean offlineFallbackTriggered = false;
    private String configuredRemoteUrl = "";
    private String configuredRemoteHost = "";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HourBlockerPlugin.class);
        super.onCreate(savedInstanceState);

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (HourBlockerState.isStrictLockActive(MainActivity.this)) {
                    notifyStrictLocked("🔒 Strict Mode active — finish your focus session first");
                    HourBlockerPlugin.emitStrictEvent("strictExitBlocked", "back_button");
                    return;
                }
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });

        if (HourBlockerState.isStrictLockActive(this)) {
            HourBlockerForegroundService.startOrUpdate(this);
            applyStrictWindowFlags(true);
        }
    }

    @Override
    protected void load() {
        CapConfig base = CapConfig.loadDefault(this);
        String savedMode = HourBlockerState.getLiveServerMode(this);
        String savedUrl = HourBlockerState.getLiveServerUrl(this);

        String effectiveUrl = null;
        if ("offline".equals(savedMode)) {
            effectiveUrl = null;
        } else if ("custom".equals(savedMode) && !savedUrl.isEmpty()) {
            effectiveUrl = savedUrl;
        } else if (base.getServerUrl() != null && !base.getServerUrl().trim().isEmpty()) {
            effectiveUrl = base.getServerUrl().trim();
        }

        configuredRemoteUrl = effectiveUrl == null ? "" : effectiveUrl;
        configuredRemoteHost = extractHost(configuredRemoteUrl);
        offlineFallbackTriggered = false;

        Set<String> navSet = new LinkedHashSet<>(Arrays.asList(
            "*.vercel.app",
            "*.web.app",
            "*.firebaseapp.com",
            "accounts.google.com",
            "*.google.com"
        ));
        if (base.getAllowNavigation() != null) {
            for (String item : base.getAllowNavigation()) {
                if (item != null && !item.trim().isEmpty()) {
                    navSet.add(item.trim());
                }
            }
        }
        if (!configuredRemoteHost.isEmpty()) {
            navSet.add(configuredRemoteHost);
        }

        boolean allowMixed = base.isMixedContentAllowed() || (!configuredRemoteUrl.isEmpty() && configuredRemoteUrl.startsWith("http://"));

        CapConfig.Builder b = new CapConfig.Builder(this)
            .setHTML5mode(base.isHTML5Mode())
            .setServerUrl(effectiveUrl)
            .setErrorPath(base.getErrorPath())
            .setHostname(base.getHostname())
            .setStartPath(base.getStartPath())
            .setAndroidScheme(base.getAndroidScheme())
            .setAllowNavigation(navSet.toArray(new String[0]))
            .setOverriddenUserAgentString(base.getOverriddenUserAgentString())
            .setAppendedUserAgentString(base.getAppendedUserAgentString())
            .setBackgroundColor(base.getBackgroundColor())
            .setAllowMixedContent(allowMixed)
            .setCaptureInput(base.isInputCaptured())
            .setUseLegacyBridge(base.isUsingLegacyBridge())
            .setResolveServiceWorkerRequests(base.isResolveServiceWorkerRequests())
            .setWebContentsDebuggingEnabled(base.isWebContentsDebuggingEnabled())
            .setZoomableWebView(base.isZoomableWebView())
            .setLoggingEnabled(base.isLoggingEnabled())
            .setInitialFocus(base.isInitialFocus());

        this.config = b.create();
        super.load();

        configureLiveUpdateBridge();
    }

    private void configureLiveUpdateBridge() {
        if (this.bridge == null || this.bridge.getWebView() == null) return;
        WebView wv = this.bridge.getWebView();
        wv.getSettings().setCacheMode(WebSettings.LOAD_DEFAULT);

        ensureDocumentStartScriptsForFallbackOrigins(wv);

        this.bridge.setWebViewClient(new BridgeWebViewClient(this.bridge) {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (shouldTriggerOfflineFallback(request)) {
                    triggerOfflineFallback(view);
                    return;
                }
                super.onReceivedError(view, request, error);
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
                int code = errorResponse != null ? errorResponse.getStatusCode() : 0;
                if ((code >= 500 || code == 404) && shouldTriggerOfflineFallback(request)) {
                    triggerOfflineFallback(view);
                    return;
                }
                super.onReceivedHttpError(view, request, errorResponse);
            }
        });
    }

    private boolean shouldTriggerOfflineFallback(WebResourceRequest request) {
        if (offlineFallbackTriggered || configuredRemoteHost.isEmpty()) return false;
        if (request == null || !request.isForMainFrame()) return false;
        Uri url = request.getUrl();
        if (url == null || url.getHost() == null) return false;
        return configuredRemoteHost.equalsIgnoreCase(url.getHost());
    }

    private void triggerOfflineFallback(WebView view) {
        if (offlineFallbackTriggered || this.bridge == null) return;
        offlineFallbackTriggered = true;
        String localUrl = this.bridge.getLocalUrl();
        runOnUiThread(() -> {
            view.loadUrl(localUrl);
            try {
                Toast.makeText(this, "Offline mode — using bundled Hour app", Toast.LENGTH_SHORT).show();
            } catch (Exception ignored) {
            }
        });
    }

    private void ensureDocumentStartScriptsForFallbackOrigins(WebView wv) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return;
        try {
            boolean isDebug = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
            String globalJS = JSExport.getGlobalJS(this, this.config.isLoggingEnabled(), isDebug);
            String bridgeJS = JSExport.getBridgeJS(this);
            List<PluginHandle> handles = new ArrayList<>();
            String[] knownPlugins = new String[] { "HourBlocker", "WebView", "CapacitorCookies", "CapacitorHttp", "SystemBars" };
            for (String id : knownPlugins) {
                PluginHandle h = this.bridge.getPlugin(id);
                if (h != null) handles.add(h);
            }
            String pluginJS = JSExport.getPluginJS(handles);
            String localUrlJS = "window.WEBVIEW_SERVER_URL = '" + this.bridge.getLocalUrl() + "';";
            String fullScript = globalJS + "\n\n" + localUrlJS + "\n\n" + bridgeJS + "\n\n" + pluginJS;

            String initialOrigin = computeOrigin(!configuredRemoteUrl.isEmpty() ? configuredRemoteUrl : this.bridge.getLocalUrl());
            for (String rule : this.bridge.getAllowedOriginRules()) {
                if (rule == null || rule.trim().isEmpty()) continue;
                String normalizedRule = rule.trim();
                if (normalizedRule.equals(initialOrigin)) continue;
                try {
                    WebViewCompat.addDocumentStartJavaScript(wv, fullScript, Collections.singleton(normalizedRule));
                } catch (Exception ignored) {
                }
            }
        } catch (Exception ignored) {
        }
    }

    private static String extractHost(String url) {
        if (url == null || url.isEmpty()) return "";
        try {
            String h = Uri.parse(url).getHost();
            return h == null ? "" : h;
        } catch (Exception ignored) {
            return "";
        }
    }

    private static String computeOrigin(String url) {
        if (url == null || url.isEmpty()) return "";
        try {
            return Uri.parse(url).buildUpon().path(null).fragment(null).clearQuery().build().toString();
        } catch (Exception ignored) {
            return url;
        }
    }

    public void applyLiveServerAndReload() {
        isReloadingConfig = true;
        recreate();
    }

    public void reloadActiveOrigin() {
        if (this.bridge == null || this.bridge.getWebView() == null) return;
        offlineFallbackTriggered = false;
        String target = !configuredRemoteUrl.isEmpty() ? configuredRemoteUrl : this.bridge.getLocalUrl();
        this.bridge.getWebView().loadUrl(target);
    }

    @Override
    public void onResume() {
        super.onResume();
        isReloadingConfig = false;
        if (HourBlockerState.isStrictLockActive(this)) {
            applyStrictWindowFlags(true);
            HourBlockerForegroundService.startOrUpdate(this);
        } else {
            applyStrictWindowFlags(false);
        }
    }

    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        enforceStrictReturnIfNeeded("home_or_recents");
    }

    @Override
    public void onStop() {
        super.onStop();
        enforceStrictReturnIfNeeded("activity_stop");
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
    }

    public void applyStrictWindowFlags(boolean strictActive) {
        try {
            if (strictActive) {
                getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                    setShowWhenLocked(true);
                }
            } else {
                getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
        } catch (Exception ignored) {
        }
    }

    private void enforceStrictReturnIfNeeded(String reason) {
        if (isReloadingConfig || isChangingConfigurations()) {
            return;
        }
        if (!HourBlockerState.isStrictLockActive(this)) {
            return;
        }
        if (HourBlockerState.isTemporarySettingsAllowed(this)) {
            return;
        }
        HourBlockerPlugin.emitStrictEvent("strictExitBlocked", reason);
        HourBlockerForegroundService.startOrUpdate(this);
        strictHandler.postDelayed(() -> {
            if (isReloadingConfig || !HourBlockerState.isStrictLockActive(this)) return;
            try {
                ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
                if (am != null) {
                    am.moveTaskToFront(getTaskId(), ActivityManager.MOVE_TASK_WITH_HOME);
                }
            } catch (Exception ignored) {
            }
            HourBlockerState.bringAppToFront(this);
            notifyStrictLocked("🔒 Strict Mode locked — returning to Hour");
        }, 120L);
    }

    private void notifyStrictLocked(String msg) {
        long now = System.currentTimeMillis();
        if (now - lastStrictToastAt < 1800L) return;
        lastStrictToastAt = now;
        try {
            Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
        } catch (Exception ignored) {
        }
    }
}
