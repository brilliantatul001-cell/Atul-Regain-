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

export interface NotifyStatusResult {
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  pushSupported: boolean;
  subscribed: boolean;
  swReady: boolean;
  inOuterIframe: boolean;
  isMedian: boolean;
  hasMedianOneSignal: boolean;
  hasMedianFcm: boolean;
  oneSignalOptedIn: boolean;
  oneSignalSubscriptionId: string;
  oneSignalExternalId: string;
  fcmToken: string;
  webPushSubscription: PushSubscriptionJSON | null;
}

export interface NotifyEnableResult extends NotifyStatusResult {
  subscription: PushSubscriptionJSON | null;
}

export interface NotifyLocalPayload {
  title?: string;
  body?: string;
  tag?: string;
  target?: string;
  category?: string;
  actions?: Array<{action: string; title: string}>;
}

export interface NotifyShowResult {
  ok: boolean;
  method: 'sw' | 'window' | 'blocked';
  error?: string;
}

export interface NotifyHostBridge {
  requestPermissionSync: () => Promise<NotificationPermission | 'unsupported'>;
  getStatus: () => Promise<NotifyStatusResult>;
  completeEnableAfterPermission: (
    intervalMin?: number,
    permOverride?: NotificationPermission | 'unsupported',
    externalId?: string,
  ) => Promise<NotifyEnableResult>;
  bindExternalId: (externalId: string) => Promise<void>;
  openAppSettings: () => boolean;
  disablePush: () => Promise<NotifyStatusResult>;
  showLocalNotification: (payload: NotifyLocalPayload) => Promise<NotifyShowResult>;
  syncSwSnapshot: (snapshot: unknown) => Promise<void>;
}

interface MedianOneSignalBridge {
  login?: (arg: string | {externalId: string}) => void;
  logout?: () => void;
  register?: () => void;
  promptNotification?: () => void;
  enableForegroundNotifications?: (enabled: boolean) => void;
  info?: (opts?: {callback?: string | ((data: Record<string, unknown>) => void)}) => Promise<Record<string, unknown>> | void;
  userPrivacyConsent?: {grant?: () => void};
}

interface MedianBridge {
  onesignal?: MedianOneSignalBridge;
  fcm?: {
    getToken?: () => Promise<string> | void;
  };
  permissions?: {
    status?: (list: string[]) => Promise<Record<string, string>>;
  };
  open?: {
    appSettings?: () => void;
  };
  notifications?: {
    requestPermission?: () => Promise<string> | void;
  };
}

declare global {
  interface Window {
    LeaveItFirebase?: FirebaseArenaBridge;
    LeaveItNotifyHost?: NotifyHostBridge;
    median?: MedianBridge;
    gonative?: MedianBridge;
    median_library_ready?: () => void;
    gonative_library_ready?: () => void;
    median_onesignal_info?: (data: Record<string, unknown>) => void;
    gonative_onesignal_info?: (data: Record<string, unknown>) => void;
    median_fcm_registration?: (data: Record<string, unknown>) => void;
  }
}

window.LeaveItFirebase = firebaseArenaBridge;

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

const isInOuterIframe = (): boolean => {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
};

const getMedianBridge = (): MedianBridge | null => {
  if (typeof window === 'undefined') return null;
  return window.median || window.gonative || null;
};

const isMedianEnvironment = (): boolean => {
  if (typeof window === 'undefined') return false;
  if (getMedianBridge()) return true;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  return /median|gonative/i.test(ua);
};

interface MedianCachedState {
  oneSignalId: string;
  externalId: string;
  subscriptionId: string;
  optedIn: boolean;
  fcmToken: string;
  androidPermStatus: string;
}

const medianState: MedianCachedState = {
  oneSignalId: '',
  externalId: '',
  subscriptionId: '',
  optedIn: false,
  fcmToken: '',
  androidPermStatus: '',
};

const extractOneSignalInfo = (data: unknown) => {
  if (!data || typeof data !== 'object') return;
  const d = data as Record<string, unknown>;
  if (typeof d.oneSignalId === 'string') medianState.oneSignalId = d.oneSignalId;
  if (typeof d.externalId === 'string') medianState.externalId = d.externalId;
  const sub = d.subscription && typeof d.subscription === 'object'
    ? (d.subscription as Record<string, unknown>)
    : null;
  if (sub) {
    if (typeof sub.id === 'string' && sub.id) medianState.subscriptionId = sub.id;
    if (typeof sub.optedIn === 'boolean') medianState.optedIn = sub.optedIn;
  } else {
    if (typeof d.userId === 'string' && d.userId) medianState.subscriptionId = d.userId;
    if (typeof d.isSubscribed === 'boolean') medianState.optedIn = d.isSubscribed;
  }
};

const refreshMedianBridgeInfo = async (): Promise<void> => {
  const bridge = getMedianBridge();
  if (!bridge) return;
  try {
    bridge.onesignal?.enableForegroundNotifications?.(true);
  } catch {
    // ignore
  }
  if (bridge.permissions?.status) {
    try {
      const res = await bridge.permissions.status(['Notifications']);
      if (res && typeof res === 'object') {
        const val = res.Notifications || res.notifications || '';
        if (typeof val === 'string') medianState.androidPermStatus = val.toLowerCase();
      }
    } catch {
      // ignore
    }
  }
  if (bridge.onesignal?.info) {
    try {
      const res = await Promise.race([
        Promise.resolve(
          bridge.onesignal.info({
            callback: 'median_onesignal_info',
          }),
        ),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 900)),
      ]);
      if (res && typeof res === 'object') {
        extractOneSignalInfo(res);
      }
    } catch {
      // ignore
    }
  }
};

const getSwRegistration = async (): Promise<ServiceWorkerRegistration | null> => {
  if (isMedianEnvironment()) return null;
  if (!('serviceWorker' in navigator)) return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration('/');
    if (existing) return existing;
  } catch {
    // ignore
  }
  try {
    const readyReg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
    ]);
    if (readyReg) return readyReg;
  } catch {
    // ignore
  }
  try {
    return await navigator.serviceWorker.register('/sw-notify.js', {scope: '/'});
  } catch {
    return null;
  }
};

const requestPermissionSyncHost = (): Promise<NotificationPermission | 'unsupported'> => {
  const bridge = getMedianBridge();
  if (bridge) {
    try {
      bridge.onesignal?.userPrivacyConsent?.grant?.();
    } catch {
      // ignore
    }
    try {
      bridge.onesignal?.enableForegroundNotifications?.(true);
    } catch {
      // ignore
    }
    try {
      if (bridge.onesignal?.register) {
        bridge.onesignal.register();
      } else if (bridge.onesignal?.promptNotification) {
        bridge.onesignal.promptNotification();
      } else if (bridge.notifications?.requestPermission) {
        void bridge.notifications.requestPermission();
      }
    } catch {
      // ignore
    }
    return new Promise((resolve) => {
      let settled = false;
      const checkAndResolve = async (isFinal: boolean) => {
        if (settled) return;
        await refreshMedianBridgeInfo();
        if (settled) return;
        if (medianState.androidPermStatus === 'denied') {
          settled = true;
          cleanup();
          resolve('denied');
          return;
        }
        if (
          medianState.optedIn ||
          medianState.subscriptionId ||
          medianState.androidPermStatus === 'granted'
        ) {
          settled = true;
          cleanup();
          resolve('granted');
          return;
        }
        if (isFinal) {
          settled = true;
          cleanup();
          resolve(bridge.onesignal ? 'default' : 'unsupported');
        }
      };
      const onFocus = () => {
        void checkAndResolve(false);
      };
      window.addEventListener('focus', onFocus);
      const t1 = setTimeout(() => void checkAndResolve(false), 700);
      const t2 = setTimeout(() => void checkAndResolve(false), 1600);
      const t3 = setTimeout(() => void checkAndResolve(true), 3200);
      const cleanup = () => {
        window.removeEventListener('focus', onFocus);
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    });
  }

  if (typeof window === 'undefined' || !('Notification' in window)) {
    return Promise.resolve('unsupported');
  }
  const current = Notification.permission;
  if (current !== 'default') {
    return Promise.resolve(current);
  }
  try {
    let cbResult: NotificationPermission | null = null;
    const maybePromise = Notification.requestPermission((perm) => {
      cbResult = perm;
    });
    if (maybePromise && typeof maybePromise.then === 'function') {
      return maybePromise.catch(() => Notification.permission);
    }
    return Promise.resolve(cbResult || Notification.permission);
  } catch {
    return Promise.resolve(Notification.permission);
  }
};

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
    const postToIframe = (payload: Record<string, unknown>) => {
      const target = iframeRef.current?.contentWindow;
      if (target) {
        target.postMessage(payload, window.location.origin);
      }
    };

    const getNotifyStatus = async (): Promise<NotifyStatusResult> => {
      const isMedian = isMedianEnvironment();
      const bridge = getMedianBridge();
      const hasMedianOneSignal = Boolean(bridge?.onesignal);
      const hasMedianFcm = Boolean(bridge?.fcm);

      if (isMedian) {
        await refreshMedianBridgeInfo();
        let perm: NotificationPermission | 'unsupported' = 'default';
        if (!hasMedianOneSignal && !hasMedianFcm) {
          perm = 'unsupported';
        } else if (medianState.androidPermStatus === 'denied') {
          perm = 'denied';
        } else if (
          medianState.optedIn ||
          medianState.subscriptionId ||
          medianState.androidPermStatus === 'granted'
        ) {
          perm = 'granted';
        }
        return {
          supported: hasMedianOneSignal || hasMedianFcm,
          permission: perm,
          pushSupported: hasMedianOneSignal || hasMedianFcm,
          subscribed: Boolean(medianState.subscriptionId || medianState.optedIn),
          swReady: false,
          inOuterIframe: false,
          isMedian: true,
          hasMedianOneSignal,
          hasMedianFcm,
          oneSignalOptedIn: medianState.optedIn,
          oneSignalSubscriptionId: medianState.subscriptionId,
          oneSignalExternalId: medianState.externalId,
          fcmToken: medianState.fcmToken,
          webPushSubscription: null,
        };
      }

      const supported = typeof window !== 'undefined' && 'Notification' in window;
      const permission: NotificationPermission | 'unsupported' = supported
        ? Notification.permission
        : 'unsupported';
      const reg = await getSwRegistration();
      const pushSupported = Boolean(reg && 'pushManager' in reg);
      let webSub: PushSubscriptionJSON | null = null;
      if (reg && 'pushManager' in reg) {
        try {
          const sub = await reg.pushManager.getSubscription();
          webSub = sub ? sub.toJSON() : null;
        } catch {
          webSub = null;
        }
      }
      return {
        supported,
        permission,
        pushSupported,
        subscribed: Boolean(webSub),
        swReady: Boolean(reg),
        inOuterIframe: isInOuterIframe(),
        isMedian: false,
        hasMedianOneSignal: false,
        hasMedianFcm: false,
        oneSignalOptedIn: false,
        oneSignalSubscriptionId: '',
        oneSignalExternalId: '',
        fcmToken: '',
        webPushSubscription: webSub,
      };
    };

    const bindExternalId = async (externalId: string): Promise<void> => {
      const clean = String(externalId || '').trim().slice(0, 128);
      if (!clean || ['null', 'undefined', 'NA', '0', 'ANONYMOUS'].includes(clean)) return;
      const bridge = getMedianBridge();
      if (!bridge?.onesignal?.login) return;
      try {
        bridge.onesignal.enableForegroundNotifications?.(true);
        bridge.onesignal.login(clean);
        medianState.externalId = clean;
      } catch {
        try {
          bridge.onesignal.login({externalId: clean});
          medianState.externalId = clean;
        } catch {
          // ignore
        }
      }
    };

    const completeEnableAfterPermission = async (
      intervalMin?: number,
      permOverride?: NotificationPermission | 'unsupported',
      externalId?: string,
    ): Promise<NotifyEnableResult> => {
      const isMedian = isMedianEnvironment();
      const bridge = getMedianBridge();

      if (isMedian) {
        if (externalId) {
          await bindExternalId(externalId);
        }
        await refreshMedianBridgeInfo();
        const st = await getNotifyStatus();
        const finalPerm =
          permOverride && permOverride !== 'unsupported' ? permOverride : st.permission;
        return {
          ...st,
          permission: finalPerm,
          subscription: null,
        };
      }

      const supported = typeof window !== 'undefined' && 'Notification' in window;
      const permission: NotificationPermission | 'unsupported' = supported
        ? permOverride && permOverride !== 'unsupported'
          ? permOverride
          : Notification.permission
        : 'unsupported';
      const reg = await getSwRegistration();
      const pushSupported = Boolean(reg && 'pushManager' in reg);
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
            const mins = Math.max(15, Number(intervalMin) || 45);
            await pSync.register('hour-auto-notify', {
              minInterval: mins * 60_000,
            });
          }
        } catch {
          // periodicSync optional on non-installed/unsupported browsers
        }
      }
      return {
        supported,
        permission,
        subscription,
        webPushSubscription: subscription,
        swReady: Boolean(reg),
        pushSupported,
        subscribed: Boolean(subscription),
        inOuterIframe: isInOuterIframe(),
        isMedian: false,
        hasMedianOneSignal: Boolean(bridge?.onesignal),
        hasMedianFcm: Boolean(bridge?.fcm),
        oneSignalOptedIn: false,
        oneSignalSubscriptionId: '',
        oneSignalExternalId: '',
        fcmToken: '',
      };
    };

    const disablePush = async (): Promise<NotifyStatusResult> => {
      const reg = await getSwRegistration();
      if (reg && 'pushManager' in reg) {
        try {
          const sub = await reg.pushManager.getSubscription();
          if (sub) await sub.unsubscribe();
        } catch {
          // ignore
        }
      }
      return getNotifyStatus();
    };

    const openAppSettings = (): boolean => {
      const bridge = getMedianBridge();
      if (bridge?.open?.appSettings) {
        try {
          bridge.open.appSettings();
          return true;
        } catch {
          return false;
        }
      }
      return false;
    };

    const showLocalNotification = async (
      payload: NotifyLocalPayload,
    ): Promise<NotifyShowResult> => {
      if (isMedianEnvironment()) {
        return {
          ok: false,
          method: 'blocked',
          error: 'Inside Median wrapper use real server push via OneSignal',
        };
      }
      if (typeof window === 'undefined' || !('Notification' in window)) {
        return {ok: false, method: 'blocked', error: 'Notifications unsupported'};
      }
      if (Notification.permission !== 'granted') {
        return {ok: false, method: 'blocked', error: 'Permission ' + Notification.permission};
      }
      const title = payload.title || 'Hour';
      const target = payload.target || 'home';
      const category = payload.category || 'reminder';
      const reg = await getSwRegistration();
      if (reg && typeof reg.showNotification === 'function') {
        try {
          await reg.showNotification(title, {
            body: payload.body || '',
            icon: '/pwa-192x192.png',
            badge: '/pwa-192x192.png',
            tag: payload.tag || 'hour-' + category,
            renotify: true,
            data: {url: '/?open=' + encodeURIComponent(target), target, category},
            actions: Array.isArray(payload.actions) ? payload.actions.slice(0, 2) : undefined,
          } as NotificationOptions);
          return {ok: true, method: 'sw'};
        } catch {
          try {
            await reg.showNotification(title, {
              body: payload.body || '',
              icon: '/pwa-192x192.png',
              tag: payload.tag || 'hour-' + category,
              data: {url: '/?open=' + encodeURIComponent(target), target, category},
            });
            return {ok: true, method: 'sw'};
          } catch {
            // Fall through to window.Notification
          }
        }
      }
      try {
        const n = new Notification(title, {
          body: payload.body || '',
          icon: '/pwa-192x192.png',
          tag: payload.tag || 'hour-' + category,
        });
        n.onclick = () => {
          window.focus();
          postToIframe({type: 'leaveit-open-target', target});
          n.close();
        };
        return {ok: true, method: 'window'};
      } catch (err) {
        return {
          ok: false,
          method: 'blocked',
          error: err instanceof Error ? err.message : 'Notification blocked',
        };
      }
    };

    const syncSwSnapshot = async (snapshot: unknown): Promise<void> => {
      const reg = await getSwRegistration();
      const sw = reg?.active || reg?.waiting || reg?.installing || navigator.serviceWorker?.controller;
      if (sw) {
        sw.postMessage({type: 'hour-notify-cache', snapshot});
      }
    };

    window.LeaveItNotifyHost = {
      requestPermissionSync: requestPermissionSyncHost,
      getStatus: getNotifyStatus,
      completeEnableAfterPermission,
      bindExternalId,
      openAppSettings,
      disablePush,
      showLocalNotification,
      syncSwSnapshot,
    };

    const pushStatusToIframe = async () => {
      postToIframe({
        type: 'leaveit-notify-status',
        ...(await getNotifyStatus()),
      });
    };

    const handleMedianInfo = (data: Record<string, unknown>) => {
      extractOneSignalInfo(data);
      void refreshMedianBridgeInfo().then(() => pushStatusToIframe());
    };
    window.median_onesignal_info = handleMedianInfo;
    window.gonative_onesignal_info = handleMedianInfo;
    window.median_fcm_registration = (data: Record<string, unknown>) => {
      if (data && typeof data.fcmToken === 'string') {
        medianState.fcmToken = data.fcmToken;
        void pushStatusToIframe();
      }
    };
    const onMedianReady = () => {
      try {
        getMedianBridge()?.onesignal?.enableForegroundNotifications?.(true);
      } catch {
        // ignore
      }
      void refreshMedianBridgeInfo().then(() => pushStatusToIframe());
    };
    window.median_library_ready = onMedianReady;
    window.gonative_library_ready = onMedianReady;
    const onWinFocus = () => {
      if (isMedianEnvironment()) {
        void refreshMedianBridgeInfo().then(() => pushStatusToIframe());
      }
    };
    window.addEventListener('focus', onWinFocus);

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
        const perm = await requestPermissionSyncHost();
        const result = await completeEnableAfterPermission(
          Number(msg.intervalMin) || 45,
          perm,
          typeof msg.externalId === 'string' ? msg.externalId : undefined,
        );
        postToIframe({
          type: 'leaveit-notify-enabled-result',
          requestId: msg.requestId,
          ...result,
        });
      } else if (msg.type === 'leaveit-notify-bind-user' && typeof msg.externalId === 'string') {
        await bindExternalId(msg.externalId);
      } else if (msg.type === 'leaveit-notify-open-settings') {
        openAppSettings();
      } else if (msg.type === 'leaveit-notify-disable') {
        const status = await disablePush();
        postToIframe({
          type: 'leaveit-notify-status',
          requestId: msg.requestId,
          ...status,
        });
      } else if (msg.type === 'leaveit-notify-show-local' && msg.payload) {
        const result = await showLocalNotification(msg.payload as NotifyLocalPayload);
        postToIframe({
          type: 'leaveit-notify-show-result',
          requestId: msg.requestId,
          ...result,
        });
      } else if (msg.type === 'leaveit-notify-sync-sw' && msg.snapshot) {
        await syncSwSnapshot(msg.snapshot);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('focus', onWinFocus);
      window.removeEventListener('message', handleMessage);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleSwMessage);
      }
    };
  }, [canInstall, isInstalled, isIOS, promptInstall]);

  const showFloatingInstall =
    !isMedianEnvironment() && !isStandalone && !isInstalled && !dismissedInstall && (canInstall || isIOS);

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
