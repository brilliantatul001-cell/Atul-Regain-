/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {useEffect, useRef, useState} from 'react';
import {Download, WifiOff, X} from 'lucide-react';
import {useOnlineStatus, usePWAInstall} from './hooks/usePWAInstall';
import {
  firebaseArenaBridge,
  type FirebaseArenaBridge,
} from './lib/firebaseArena';

const SPA_ASSET_PATH = '/assets/aistudio/Leave_It_v101_Laptop_Fixed_d7f9ca8a.html';

export interface NativeBlockerBridge {
  isNativeAndroid: () => boolean;
  getPermissionStatus: () => Promise<Record<string, unknown>>;
  requestPermission: (type: string) => Promise<Record<string, unknown>>;
  getInstalledApps: (includeIcons?: boolean) => Promise<{apps: Array<{packageName: string; appName: string; blocked?: boolean; icon?: string}>; count: number}>;
  setBlockedApps: (packages: string[], names?: Record<string, string>) => Promise<{savedCount: number}>;
  startFocusSession: (opts: {
    durationSec: number;
    endsAtMs: number;
    strictMode: boolean;
    taskTitle?: string;
    blockedPackages?: Array<string | {packageName: string; appName: string}>;
  }) => Promise<Record<string, unknown>>;
  updateFocusSession: (opts: {
    endsAtMs?: number;
    strictMode?: boolean;
    paused?: boolean;
    taskTitle?: string;
  }) => Promise<Record<string, unknown>>;
  stopFocusSession: (forceCompleted?: boolean) => Promise<Record<string, unknown>>;
  getActiveSession: () => Promise<Record<string, unknown>>;
  getLiveServerUrl: () => Promise<{savedUrl: string; mode: string; activeServerUrl: string; currentUrl: string; localUrl: string}>;
  setLiveServerUrl: (url: string, mode?: string) => Promise<{savedUrl: string; mode: string; reloading: boolean}>;
  reloadLiveApp: () => Promise<{reloaded: boolean; url: string}>;
}

declare global {
  interface Window {
    LeaveItFirebase?: FirebaseArenaBridge;
    LeaveItNativeBlocker?: NativeBlockerBridge;
    Capacitor?: {
      platform?: string;
      getPlatform?: () => string;
      isNativePlatform?: () => boolean;
      Plugins?: Record<string, any>;
    };
  }
}

function getCapPlugin() {
  const cap = window.Capacitor;
  if (!cap) return null;
  const isNative =
    typeof cap.isNativePlatform === 'function'
      ? cap.isNativePlatform()
      : Boolean(cap.platform && cap.platform !== 'web');
  if (!isNative) return null;
  return cap.Plugins?.HourBlocker || null;
}

const nativeBlockerBridge: NativeBlockerBridge = {
  isNativeAndroid: () => {
    const cap = window.Capacitor;
    if (!cap) return false;
    const platform = typeof cap.getPlatform === 'function' ? cap.getPlatform() : cap.platform;
    const isNative = typeof cap.isNativePlatform === 'function' ? cap.isNativePlatform() : Boolean(platform && platform !== 'web');
    return Boolean(isNative && (!platform || platform === 'android') && getCapPlugin());
  },
  getPermissionStatus: async () => {
    const p = getCapPlugin();
    if (!p) return {native: false};
    return await p.getPermissionStatus();
  },
  requestPermission: async (type: string) => {
    const p = getCapPlugin();
    if (!p) return {opened: false};
    return await p.requestPermission({type});
  },
  getInstalledApps: async (includeIcons = true) => {
    const p = getCapPlugin();
    if (!p) return {apps: [], count: 0};
    return await p.getInstalledApps({includeIcons});
  },
  setBlockedApps: async (packages: string[], names?: Record<string, string>) => {
    const p = getCapPlugin();
    if (!p) return {savedCount: packages.length};
    return await p.setBlockedApps({packages, names: names || {}});
  },
  startFocusSession: async (opts) => {
    const p = getCapPlugin();
    if (!p) return {sessionActive: false};
    return await p.startFocusSession(opts);
  },
  updateFocusSession: async (opts) => {
    const p = getCapPlugin();
    if (!p) return {sessionActive: false};
    return await p.updateFocusSession(opts);
  },
  stopFocusSession: async (forceCompleted = false) => {
    const p = getCapPlugin();
    if (!p) return {stopped: true};
    return await p.stopFocusSession({forceCompleted});
  },
  getActiveSession: async () => {
    const p = getCapPlugin();
    if (!p) return {sessionActive: false, strictLockActive: false};
    return await p.getActiveSession();
  },
  getLiveServerUrl: async () => {
    const p = getCapPlugin();
    if (!p || typeof p.getLiveServerUrl !== 'function') {
      return {savedUrl: '', mode: '', activeServerUrl: '', currentUrl: window.location.origin, localUrl: 'https://localhost'};
    }
    return await p.getLiveServerUrl();
  },
  setLiveServerUrl: async (url: string, mode = 'custom') => {
    const p = getCapPlugin();
    if (!p || typeof p.setLiveServerUrl !== 'function') {
      return {savedUrl: '', mode: '', reloading: false};
    }
    return await p.setLiveServerUrl({url, mode});
  },
  reloadLiveApp: async () => {
    const p = getCapPlugin();
    if (!p || typeof p.reloadLiveApp !== 'function') {
      window.location.reload();
      return {reloaded: true, url: window.location.href};
    }
    return await p.reloadLiveApp();
  },
};

window.LeaveItFirebase = firebaseArenaBridge;
window.LeaveItNativeBlocker = nativeBlockerBridge;

export default function App() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const {canInstall, isInstalled, isIOS, isStandalone, promptInstall} =
    usePWAInstall();
  const isOnline = useOnlineStatus();
  const [dismissedInstall, setDismissedInstall] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  useEffect(() => {
    window.LeaveItFirebase = firebaseArenaBridge;
    window.LeaveItNativeBlocker = nativeBlockerBridge;
    void firebaseArenaBridge.completeEmailLinkIfPresent().catch(() => {});

    const blockerPlugin = getCapPlugin();
    const listeners: Array<{remove?: () => void}> = [];
    if (blockerPlugin && typeof blockerPlugin.addListener === 'function') {
      const forward = (type: string) => (payload: any) => {
        iframeRef.current?.contentWindow?.postMessage(
          {type, payload: payload || {}},
          window.location.origin,
        );
      };
      try {
        listeners.push(blockerPlugin.addListener('strictExitBlocked', forward('leaveit-native-strict-blocked')));
        listeners.push(blockerPlugin.addListener('blockedAppIntercepted', forward('leaveit-native-app-blocked')));
      } catch {}
    }

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    const onTouch = (e: TouchEvent) => {
      if (e.touches && e.touches.length > 1) e.preventDefault();
    };
    const onGesture = (e: Event) => {
      e.preventDefault();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '_' || e.key === '0')
      ) {
        e.preventDefault();
      }
    };

    window.addEventListener('wheel', onWheel, {passive: false});
    document.addEventListener('touchstart', onTouch, {passive: false});
    document.addEventListener('touchmove', onTouch, {passive: false});
    document.addEventListener('gesturestart', onGesture, {passive: false} as AddEventListenerOptions);
    document.addEventListener('gesturechange', onGesture, {passive: false} as AddEventListenerOptions);
    document.addEventListener('gestureend', onGesture, {passive: false} as AddEventListenerOptions);
    window.addEventListener('keydown', onKeyDown, {passive: false});

    return () => {
      listeners.forEach((l) => {
        try {
          l && typeof l.remove === 'function' && l.remove();
        } catch {}
      });
      window.removeEventListener('wheel', onWheel);
      document.removeEventListener('touchstart', onTouch);
      document.removeEventListener('touchmove', onTouch);
      document.removeEventListener('gesturestart', onGesture);
      document.removeEventListener('gesturechange', onGesture);
      document.removeEventListener('gestureend', onGesture);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    const postInstallState = () => {
      const target = iframeRef.current?.contentWindow;
      if (!target) return;
      target.postMessage(
        {
          type: isInstalled
            ? 'leaveit-pwa-installed'
            : 'leaveit-pwa-install-available',
          canInstall,
        },
        window.location.origin,
      );
    };

    postInstallState();

    const handleMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin || !event.data) return;
      if (event.data.type === 'leaveit-iframe-ready') {
        postInstallState();
      } else if (event.data.type === 'leaveit-trigger-install') {
        if (canInstall) {
          await promptInstall();
        } else if (isIOS) {
          setShowIOSGuide(true);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [canInstall, isInstalled, isIOS, promptInstall]);

  const showFloatingInstall =
    !isStandalone && !isInstalled && !dismissedInstall && (canInstall || isIOS);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-[#0b0b0b]">
      {!isOnline && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-amber-500/95 px-3.5 py-1.5 text-xs font-semibold text-slate-950 shadow-lg backdrop-blur"
        >
          <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Offline mode active</span>
        </div>
      )}

      <iframe
        ref={iframeRef}
        src={SPA_ASSET_PATH}
        title="Hour"
        className="block h-full w-full border-0 bg-[#0b0b0b]"
        allow="fullscreen; autoplay; microphone; clipboard-write; wake-lock"
        onLoad={() => {
          iframeRef.current?.contentWindow?.postMessage(
            {
              type: isInstalled
                ? 'leaveit-pwa-installed'
                : 'leaveit-pwa-install-available',
              canInstall,
            },
            window.location.origin,
          );
        }}
      />

      {showFloatingInstall && (
        <div className="fixed bottom-24 right-4 z-40 flex items-center gap-1.5 rounded-full border border-white/15 bg-[#181c30]/95 p-1 pl-3 text-xs font-semibold text-white shadow-xl backdrop-blur">
          <button
            type="button"
            onClick={() => {
              if (canInstall) {
                void promptInstall();
              } else {
                setShowIOSGuide((v) => !v);
              }
            }}
            className="flex cursor-pointer items-center gap-1.5 py-1 pr-1 transition-colors hover:text-[#3ddc97]"
          >
            <Download className="h-3.5 w-3.5 text-[#3ddc97]" aria-hidden="true" />
            <span>Install App</span>
          </button>
          <button
            type="button"
            aria-label="Dismiss install prompt"
            onClick={() => setDismissedInstall(true)}
            className="cursor-pointer rounded-full p-1 text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {showIOSGuide && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Install on iOS"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
          onClick={() => setShowIOSGuide(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#181c30] p-5 text-sm text-slate-200 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-base font-bold text-white">Install Hour</h2>
              <button
                type="button"
                aria-label="Close install instructions"
                onClick={() => setShowIOSGuide(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <p className="leading-relaxed text-slate-300">
              Tap the <strong className="text-white">Share</strong> button in Safari, then choose{' '}
              <strong className="text-white">Add to Home Screen</strong> to use Hour offline like a native app.
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
