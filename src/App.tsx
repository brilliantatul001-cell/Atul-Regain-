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

declare global {
  interface Window {
    LeaveItFirebase?: FirebaseArenaBridge;
  }
}

window.LeaveItFirebase = firebaseArenaBridge;

export default function App() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const {canInstall, isInstalled, isIOS, isStandalone, promptInstall} =
    usePWAInstall();
  const isOnline = useOnlineStatus();
  const [dismissedInstall, setDismissedInstall] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  useEffect(() => {
    window.LeaveItFirebase = firebaseArenaBridge;
    void firebaseArenaBridge.completeEmailLinkIfPresent().catch(() => {});

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
    const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
      const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
      const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
      const rawData = window.atob(base64);
      const outputArray = new Uint8Array(rawData.length);
      for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
      }
      return outputArray;
    };

    const getSwReg = async (): Promise<ServiceWorkerRegistration | null> => {
      if (!('serviceWorker' in navigator)) return null;
      try {
        const existing = await navigator.serviceWorker.getRegistration('/');
        if (existing) return existing;
      } catch {
        // ignore
      }
      try {
        return await Promise.race([
          navigator.serviceWorker.ready,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 3500)),
        ]);
      } catch {
        return null;
      }
    };

    const getNotifyStatus = async () => {
      const supported = typeof window !== 'undefined' && 'Notification' in window;
      const permission = supported ? Notification.permission : 'unsupported';
      const reg = await getSwReg();
      const pushSupported = Boolean(reg && 'pushManager' in reg);
      let subscribed = false;
      if (reg && 'pushManager' in reg) {
        try {
          const sub = await reg.pushManager.getSubscription();
          subscribed = Boolean(sub);
        } catch {
          subscribed = false;
        }
      }
      return {supported, permission, pushSupported, subscribed, swReady: Boolean(reg)};
    };

    const postToIframe = (payload: Record<string, unknown>) => {
      const target = iframeRef.current?.contentWindow;
      if (target) {
        target.postMessage(payload, window.location.origin);
      }
    };

    const postInstallState = () => {
      postToIframe({
        type: isInstalled
          ? 'leaveit-pwa-installed'
          : 'leaveit-pwa-install-available',
        canInstall,
      });
    };

    const initialOpen = new URLSearchParams(window.location.search).get('open');
    if (initialOpen) {
      window.history.replaceState({}, '', window.location.pathname);
    }

    postInstallState();

    const handleSwMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'leaveit-notif-open' && event.data.target) {
        postToIframe({
          type: 'leaveit-open-target',
          target: String(event.data.target),
        });
      }
    };

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleSwMessage);
    }

    const handleMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin || !event.data) return;
      const msg = event.data as Record<string, unknown>;
      if (msg.type === 'leaveit-iframe-ready') {
        postInstallState();
        postToIframe({
          type: 'leaveit-notify-status',
          ...(await getNotifyStatus()),
        });
        if (initialOpen) {
          postToIframe({type: 'leaveit-open-target', target: initialOpen});
        }
      } else if (msg.type === 'leaveit-trigger-install') {
        if (canInstall) {
          await promptInstall();
        } else if (isIOS) {
          setShowIOSGuide(true);
        }
      } else if (msg.type === 'leaveit-notify-query-status') {
        postToIframe({
          type: 'leaveit-notify-status',
          requestId: msg.requestId,
          ...(await getNotifyStatus()),
        });
      } else if (msg.type === 'leaveit-notify-enable') {
        const supported = 'Notification' in window;
        let permission: NotificationPermission | 'unsupported' = supported
          ? Notification.permission
          : 'unsupported';
        if (supported && permission === 'default') {
          try {
            permission = await Notification.requestPermission();
          } catch {
            permission = Notification.permission;
          }
        }
        const reg = await getSwReg();
        let subscription: PushSubscriptionJSON | null = null;
        if (permission === 'granted' && reg && 'pushManager' in reg) {
          try {
            let sub = await reg.pushManager.getSubscription();
            if (!sub) {
              const keyRes = await fetch('/api/push/vapid-public-key');
              if (keyRes.ok) {
                const {publicKey} = (await keyRes.json()) as {publicKey?: string};
                if (publicKey) {
                  sub = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
                  });
                }
              }
            }
            subscription = sub ? sub.toJSON() : null;
          } catch {
            subscription = null;
          }
          try {
            const pSync = (reg as ServiceWorkerRegistration & {
              periodicSync?: {register: (tag: string, opts: {minInterval: number}) => Promise<void>};
            }).periodicSync;
            if (pSync) {
              const intervalMin = Math.max(15, Number(msg.intervalMin) || 45);
              await pSync.register('hour-auto-notify', {
                minInterval: intervalMin * 60_000,
              });
            }
          } catch {
            // periodicSync optional on non-installed/unsupported browsers
          }
        }
        postToIframe({
          type: 'leaveit-notify-enabled-result',
          requestId: msg.requestId,
          permission,
          subscription,
          swReady: Boolean(reg),
          pushSupported: Boolean(reg && 'pushManager' in reg),
          subscribed: Boolean(subscription),
        });
      } else if (msg.type === 'leaveit-notify-disable') {
        const reg = await getSwReg();
        if (reg && 'pushManager' in reg) {
          try {
            const sub = await reg.pushManager.getSubscription();
            if (sub) await sub.unsubscribe();
          } catch {
            // ignore
          }
        }
        postToIframe({
          type: 'leaveit-notify-status',
          requestId: msg.requestId,
          ...(await getNotifyStatus()),
        });
      } else if (msg.type === 'leaveit-notify-show-local' && msg.payload) {
        const payload = msg.payload as {
          title?: string;
          body?: string;
          tag?: string;
          target?: string;
          category?: string;
          actions?: Array<{action: string; title: string}>;
        };
        if ('Notification' in window && Notification.permission === 'granted') {
          const reg = await getSwReg();
          if (reg) {
            try {
              const target = payload.target || 'home';
              const category = payload.category || 'reminder';
              await reg.showNotification(payload.title || 'Hour', {
                body: payload.body || '',
                icon: '/pwa-192x192.png',
                badge: '/pwa-192x192.png',
                tag: payload.tag || 'hour-' + category,
                data: {url: '/?open=' + encodeURIComponent(target), target, category},
                actions: payload.actions,
              } as NotificationOptions);
            } catch {
              // ignore
            }
          } else {
            try {
              const n = new Notification(payload.title || 'Hour', {
                body: payload.body || '',
                icon: '/pwa-192x192.png',
                tag: payload.tag || 'hour-local',
              });
              n.onclick = () => {
                window.focus();
                postToIframe({
                  type: 'leaveit-open-target',
                  target: payload.target || 'home',
                });
                n.close();
              };
            } catch {
              // ignore
            }
          }
        }
      } else if (msg.type === 'leaveit-notify-sync-sw' && msg.snapshot) {
        const reg = await getSwReg();
        const sw = reg?.active || navigator.serviceWorker?.controller;
        if (sw) {
          sw.postMessage({type: 'hour-notify-cache', snapshot: msg.snapshot});
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleSwMessage);
      }
    };
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
