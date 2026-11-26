/* Service Worker module for Android PWA push, scheduled local alerts, and click deep-linking */
const NOTIFY_CACHE = 'hour-notify-v1';

self.addEventListener('install', () => {
  if (typeof self.skipWaiting === 'function') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  if (self.clients && typeof self.clients.claim === 'function') {
    event.waitUntil(self.clients.claim());
  }
});

function buildNotificationOptions(payload) {
  const target = (payload && payload.target) || 'home';
  const category = (payload && payload.category) || 'reminder';
  const actions = Array.isArray(payload && payload.actions) && payload.actions.length
    ? payload.actions.slice(0, 2)
    : [
        { action: 'open-' + target, title: target === 'plan' ? 'Open Planner' : target === 'stats' ? 'View Stats' : 'Open Hour' },
        { action: 'open-focus', title: 'Start Focus' },
      ];

  return {
    body: (payload && payload.body) || 'Time for a quick study check-in.',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: (payload && payload.tag) || ('hour-' + category),
    renotify: true,
    vibrate: [140, 70, 140],
    timestamp: Date.now(),
    data: {
      url: '/?open=' + encodeURIComponent(target),
      target,
      category,
    },
    actions,
  };
}

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    try {
      payload = { body: event.data ? event.data.text() : '' };
    } catch {
      payload = {};
    }
  }
  const title = (payload && payload.title) || 'Hour';
  event.waitUntil(
    self.registration.showNotification(title, buildNotificationOptions(payload))
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  let target = data.target || 'home';
  if (event.action && String(event.action).startsWith('open-')) {
    target = String(event.action).slice(5) || target;
  }
  const destUrl = '/?open=' + encodeURIComponent(target);

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of clientList) {
        if ('focus' in client) {
          await client.focus();
          client.postMessage({ type: 'leaveit-notif-open', target });
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(destUrl);
      }
    })()
  );
});

self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'hour-show-notification' && msg.payload) {
    const title = msg.payload.title || 'Hour';
    event.waitUntil(
      self.registration.showNotification(title, buildNotificationOptions(msg.payload))
    );
  } else if (msg.type === 'hour-notify-cache' && msg.snapshot) {
    event.waitUntil(
      (async () => {
        try {
          const cache = await caches.open(NOTIFY_CACHE);
          await cache.put(
            '/__hour_notify_snapshot.json',
            new Response(JSON.stringify(msg.snapshot), {
              headers: { 'Content-Type': 'application/json' },
            })
          );
        } catch {
          // ignore cache failures
        }
      })()
    );
  }
});

async function readCachedSnapshot() {
  try {
    const cache = await caches.open(NOTIFY_CACHE);
    const res = await cache.match('/__hour_notify_snapshot.json');
    if (res) return await res.json();
  } catch {
    // ignore
  }
  return null;
}

function buildFallbackOfflineAlert(snap) {
  const name = (snap && snap.name ? String(snap.name).trim() : '') || 'Champion';
  const pending = (snap && Array.isArray(snap.pendingTasks) && snap.pendingTasks) || [];
  const qToday = Number(snap && snap.questionsToday) || 0;
  const minToday = Number(snap && snap.practiceMinToday) || 0;
  const streak = Number(snap && snap.streak) || 0;
  const pool = [
    {
      title: `Hey ${name}, quick focus check`,
      body: pending[0]
        ? `Pending task: ${pending[0].title}. Open Hour and knock it out!`
        : 'Pick one target and start a 25-minute deep Focus session.',
      target: pending[0] ? 'plan' : 'focus',
      category: 'task',
    },
    {
      title: `Stats pulse · ${qToday} solved/attempted`,
      body: `${minToday} min practiced today${streak > 1 ? ` · ${streak}-day streak active 🔥` : ''}. Keep going!`,
      target: 'stats',
      category: 'stats',
    },
    {
      title: 'Checkpoint rule reminder',
      body: 'If you cannot name your next step in 5 seconds, leave the question and save your time.',
      target: 'home',
      category: 'reminder',
    },
  ];
  return pool[Math.floor(Math.random() * pool.length)];
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag !== 'hour-auto-notify') return;
  event.waitUntil(
    (async () => {
      const snap = await readCachedSnapshot();
      if (snap && snap.enabled === false) return;
      const deviceId = snap && snap.deviceId ? String(snap.deviceId) : '';
      let payload = null;
      if (deviceId) {
        try {
          const resp = await fetch('/api/push/pull-random?deviceId=' + encodeURIComponent(deviceId), {
            cache: 'no-store',
          });
          if (resp.ok) {
            const data = await resp.json();
            if (data && data.skip) return;
            if (data && data.payload) payload = data.payload;
          }
        } catch {
          // offline fallback below
        }
      }
      if (!payload) {
        payload = buildFallbackOfflineAlert(snap);
      }
      await self.registration.showNotification(
        payload.title || 'Hour',
        buildNotificationOptions(payload)
      );
    })()
  );
});
