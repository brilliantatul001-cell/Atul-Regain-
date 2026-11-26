import fs from 'node:fs';
import path from 'node:path';
import express, {type Express, type Request, type Response} from 'express';
import * as webpushNs from 'web-push';

const webpush = (
  (webpushNs as unknown as {default?: typeof webpushNs}).default ?? webpushNs
) as typeof webpushNs;
import {
  advanceOutOfQuiet,
  buildFriendOnlinePayload,
  buildRandomNotification,
  cancelOneSignalNotifications,
  generatePlannedQueue,
  isOneSignalConfigured,
  isQuietAt,
  sanitizeConfig,
  sanitizeCustomPayload,
  sanitizeSnapshot,
  scheduleOneSignalQueue,
  sendOneSignalPush,
  sendWebPushWithKeys,
  validateSubscription,
  VALID_CATEGORIES,
  type NotifyCategory,
  type NotifyConfig,
  type PlannedSlot,
  type PushSubscriptionData,
  type StudySnapshot,
} from './pushCore.ts';

export interface PresenceEntry {
  uid: string;
  username: string;
  displayName: string;
  isOnline: boolean;
  lastSeenAtMs: number;
  updatedAt: number;
}

interface DeviceRecord {
  deviceId: string;
  uid?: string;
  friendUids?: string[];
  subscription: PushSubscriptionData | null;
  oneSignalSubscriptionId?: string;
  externalId?: string;
  scheduledIds?: string[];
  config: NotifyConfig;
  snapshot: StudySnapshot;
  nextFireAt: number;
  lastSentAt: number;
  lastCategory: NotifyCategory | null;
  plannedQueue: PlannedSlot[];
  history: Array<{
    at: number;
    category: NotifyCategory;
    title: string;
    body: string;
  }>;
  updatedAt: number;
}

interface PushStore {
  vapid: {
    publicKey: string;
    privateKey: string;
  };
  devices: Record<string, DeviceRecord>;
  presence?: Record<string, PresenceEntry>;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'push-store.json');

let store: PushStore;

function loadOrInitStore(): PushStore {
  const envPub = process.env.VAPID_PUBLIC_KEY;
  const envPriv = process.env.VAPID_PRIVATE_KEY;

  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')) as Partial<PushStore>;
      if (
        raw &&
        raw.vapid &&
        typeof raw.vapid.publicKey === 'string' &&
        typeof raw.vapid.privateKey === 'string'
      ) {
        return {
          vapid:
            envPub && envPriv
              ? {publicKey: envPub, privateKey: envPriv}
              : raw.vapid,
          devices: raw.devices && typeof raw.devices === 'object' ? raw.devices : {},
          presence: raw.presence && typeof raw.presence === 'object' ? raw.presence : {},
        };
      }
    }
  } catch {
    // fallback to fresh store
  }

  const vapid =
    envPub && envPriv
      ? {publicKey: envPub, privateKey: envPriv}
      : webpush.generateVAPIDKeys();

  const fresh: PushStore = {vapid, devices: {}, presence: {}};
  saveStore(fresh);
  return fresh;
}

function saveStore(target: PushStore = store): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, {recursive: true});
    }
    fs.writeFileSync(STORE_PATH, JSON.stringify(target, null, 2), 'utf8');
  } catch {
    // non-fatal if filesystem is read-only
  }
}

store = loadOrInitStore();
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:notifications@hour.app';
webpush.setVapidDetails(VAPID_SUBJECT, store.vapid.publicKey, store.vapid.privateKey);

async function sendDevicePush(
  record: DeviceRecord,
  payload: ReturnType<typeof buildRandomNotification>,
  origin?: string,
): Promise<{ok: boolean; provider?: string; gone?: boolean; error?: string}> {
  if ((record.oneSignalSubscriptionId || record.externalId) && isOneSignalConfigured()) {
    const osRes = await sendOneSignalPush({
      subscriptionIds: record.oneSignalSubscriptionId ? [record.oneSignalSubscriptionId] : undefined,
      externalIds: record.externalId ? [record.externalId] : undefined,
      payload,
      origin,
    });
    if (osRes.ok) {
      return {ok: true, provider: 'onesignal'};
    }
  }
  if (record.subscription) {
    const wpRes = await sendWebPushWithKeys(
      record.subscription,
      payload as unknown as Record<string, unknown>,
      {
        publicKey: store.vapid.publicKey,
        privateKey: store.vapid.privateKey,
        subject: VAPID_SUBJECT,
      },
    );
    if (wpRes.gone) {
      record.subscription = null;
      saveStore();
    }
    return {...wpRes, provider: 'webpush'};
  }
  return {ok: false, error: 'no_subscription'};
}

export function registerPushPlanner(app: Express): void {
  const router = express.Router();
  router.use(express.json({limit: '64kb'}));
  router.use(express.text({type: 'text/plain', limit: '32kb'}));

  const sseClients = new Map<string, Set<Response>>();
  const friendAlertCooldown = new Map<string, number>();

  function emitSseToUser(uid: string, eventName: string, data: unknown): void {
    const clients = sseClients.get(uid);
    if (!clients || !clients.size) return;
    const msg = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) {
      try {
        client.write(msg);
      } catch {
        clients.delete(client);
      }
    }
  }

  function emitPresenceUpdate(entry: PresenceEntry): void {
    const msg = `event: presence-update\ndata: ${JSON.stringify(entry)}\n\n`;
    for (const clients of sseClients.values()) {
      for (const client of clients) {
        try {
          client.write(msg);
        } catch {
          clients.delete(client);
        }
      }
    }
  }

  router.get('/status', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      mode: 'express',
      oneSignalConfigured: isOneSignalConfigured(),
      webPushConfigured: Boolean(store.vapid.publicKey && store.vapid.privateKey),
    });
  });

  router.get('/vapid-public-key', (_req: Request, res: Response) => {
    res.json({publicKey: store.vapid.publicKey});
  });

  router.get('/events', (req: Request, res: Response) => {
    const uid =
      typeof req.query.uid === 'string' ? req.query.uid.trim().slice(0, 128) : '';
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const key = uid || '__anon__';
    let set = sseClients.get(key);
    if (!set) {
      set = new Set();
      sseClients.set(key, set);
    }
    set.add(res);
    res.write(`event: connected\ndata: ${JSON.stringify({ok: true, serverNow: Date.now()})}\n\n`);

    const keepAlive = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(keepAlive);
      }
    }, 25_000);

    req.on('close', () => {
      clearInterval(keepAlive);
      set?.delete(res);
      if (set && set.size === 0) {
        sseClients.delete(key);
      }
    });
  });

  router.get('/presence', (_req: Request, res: Response) => {
    const now = Date.now();
    const map = store.presence || {};
    const out: Record<string, {uid: string; isOnline: boolean; lastSeenAtMs: number}> = {};
    for (const [uid, p] of Object.entries(map)) {
      const onlineNow = Boolean(p.isOnline) && now - (p.lastSeenAtMs || 0) < 120_000;
      out[uid] = {
        uid,
        isOnline: onlineNow,
        lastSeenAtMs: p.lastSeenAtMs || p.updatedAt || 0,
      };
    }
    res.json({serverNow: now, presence: out});
  });

  router.post('/presence', async (req: Request, res: Response) => {
    let body: Record<string, unknown> = {};
    if (typeof req.body === 'string') {
      try {
        body = JSON.parse(req.body) as Record<string, unknown>;
      } catch {
        body = {};
      }
    } else if (req.body && typeof req.body === 'object') {
      body = req.body as Record<string, unknown>;
    }

    const uid = typeof body.uid === 'string' ? body.uid.trim().slice(0, 128) : '';
    if (!uid) {
      res.status(400).json({error: 'uid is required'});
      return;
    }

    const username =
      typeof body.username === 'string' ? body.username.trim().slice(0, 20) : 'player';
    const displayName =
      typeof body.displayName === 'string'
        ? body.displayName.trim().slice(0, 24)
        : username;
    const isOnline = body.isOnline !== false;
    const deviceId =
      typeof body.deviceId === 'string' ? body.deviceId.trim().slice(0, 64) : '';
    const friendUids = Array.isArray(body.friendUids)
      ? body.friendUids
          .filter((id): id is string => typeof id === 'string' && id.trim().length > 0 && id !== uid)
          .map((id) => id.trim().slice(0, 128))
          .slice(0, 60)
      : [];

    const now = Date.now();
    if (!store.presence) store.presence = {};
    const prev = store.presence[uid];
    const wasOnlineRecently =
      Boolean(prev?.isOnline) && now - (prev?.lastSeenAtMs || 0) < 120_000;

    const entry: PresenceEntry = {
      uid,
      username: username || prev?.username || 'player',
      displayName: displayName || prev?.displayName || 'Player',
      isOnline,
      lastSeenAtMs: now,
      updatedAt: now,
    };
    store.presence[uid] = entry;

    if (deviceId && store.devices[deviceId]) {
      store.devices[deviceId].uid = uid;
      store.devices[deviceId].externalId = uid;
      if (friendUids.length) {
        store.devices[deviceId].friendUids = friendUids;
      }
    }
    saveStore();
    emitPresenceUpdate(entry);

    let notifiedFriends = 0;
    if (isOnline && !wasOnlineRecently && friendUids.length > 0) {
      const payload = buildFriendOnlinePayload({
        uid,
        username: entry.username,
        displayName: entry.displayName,
        xp: typeof body.xp === 'number' ? Math.max(0, Math.round(body.xp)) : undefined,
        streakDays:
          typeof body.streakDays === 'number' ? Math.max(0, Math.round(body.streakDays)) : undefined,
      });

      const friendSet = new Set(friendUids);
      const osTargetUids: string[] = [];
      for (const fUid of friendSet) {
        const pairKey = `${uid}->${fUid}`;
        const lastAlert = friendAlertCooldown.get(pairKey) || 0;
        if (now - lastAlert < 5 * 60_000) continue;
        friendAlertCooldown.set(pairKey, now);

        emitSseToUser(fUid, 'friend-online', payload);
        osTargetUids.push(fUid);
        notifiedFriends++;
      }

      if (osTargetUids.length && isOneSignalConfigured()) {
        await sendOneSignalPush({
          externalIds: osTargetUids,
          payload,
        });
      }

      const pushTasks: Promise<void>[] = [];
      for (const rec of Object.values(store.devices)) {
        const targetUid = rec.uid || rec.snapshot?.uid || '';
        const matchesFriend =
          (targetUid && friendSet.has(targetUid)) ||
          (Array.isArray(rec.friendUids) && rec.friendUids.includes(uid));
        if (!matchesFriend) continue;
        if (!rec.subscription || !rec.config.enabled) continue;
        if (rec.config.categories.compete === false) continue;
        if (isQuietAt(now, rec.config)) continue;

        const devPairKey = `${uid}->dev:${rec.deviceId}`;
        const lastDevAlert = friendAlertCooldown.get(devPairKey) || 0;
        if (now - lastDevAlert < 5 * 60_000) continue;
        friendAlertCooldown.set(devPairKey, now);

        pushTasks.push(
          sendWebPushWithKeys(rec.subscription, payload as unknown as Record<string, unknown>, {
            publicKey: store.vapid.publicKey,
            privateKey: store.vapid.privateKey,
            subject: VAPID_SUBJECT,
          }).then((r) => {
            if (r.gone) {
              rec.subscription = null;
            }
            if (r.ok) {
              rec.history = [
                {at: now, category: 'compete' as NotifyCategory, title: payload.title, body: payload.body},
                ...rec.history,
              ].slice(0, 15);
            }
          }),
        );
      }
      if (pushTasks.length) {
        await Promise.all(pushTasks);
        saveStore();
      }
    }

    res.json({
      ok: true,
      presence: entry,
      becameOnline: isOnline && !wasOnlineRecently,
      notifiedFriends,
    });
  });

  router.post('/subscribe', async (req: Request, res: Response) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const deviceId =
      typeof body.deviceId === 'string'
        ? body.deviceId.trim().slice(0, 64)
        : '';
    if (!deviceId) {
      res.status(400).json({error: 'deviceId is required'});
      return;
    }

    const sub = validateSubscription(body.subscription);
    const oneSignalSubscriptionId =
      typeof body.oneSignalSubscriptionId === 'string'
        ? body.oneSignalSubscriptionId.trim().slice(0, 128)
        : '';
    const externalId =
      typeof body.externalId === 'string' ? body.externalId.trim().slice(0, 128) : '';

    if (!sub && !oneSignalSubscriptionId && !externalId) {
      res.status(400).json({error: 'Valid push subscription or OneSignal ID is required'});
      return;
    }

    const existing = store.devices[deviceId];
    const cancelIds = [
      ...(existing?.scheduledIds || []),
      ...(Array.isArray(body.cancelIds) ? body.cancelIds : []),
    ];
    if (cancelIds.length) {
      await cancelOneSignalNotifications(cancelIds);
    }

    const config = sanitizeConfig(body.config, existing?.config);
    config.enabled = typeof body.config?.enabled === 'boolean' ? body.config.enabled : true;
    const snapshot = sanitizeSnapshot(body.snapshot, existing?.snapshot);
    const uid =
      (typeof body.uid === 'string' ? body.uid.trim().slice(0, 128) : '') ||
      snapshot.uid ||
      existing?.uid ||
      '';
    const resolvedExternalId = externalId || uid || existing?.externalId || `hour_${deviceId}`;
    const friendUids = Array.isArray(body.friendUids)
      ? body.friendUids
          .filter((x: unknown): x is string => typeof x === 'string' && x.trim().length > 0)
          .slice(0, 60)
      : existing?.friendUids || (snapshot.friends || []).map((f) => f.uid);
    const now = Date.now();
    const origin = typeof body.origin === 'string' ? body.origin : '';

    let queue: PlannedSlot[];
    let scheduledIds: string[] = [];
    if (
      config.enabled &&
      isOneSignalConfigured() &&
      (oneSignalSubscriptionId || resolvedExternalId)
    ) {
      const scheduled = await scheduleOneSignalQueue({
        subscriptionId: oneSignalSubscriptionId || existing?.oneSignalSubscriptionId,
        externalId: resolvedExternalId,
        snapshot,
        config,
        lastCategory: existing?.lastCategory || null,
        origin,
      });
      queue = scheduled.queue;
      scheduledIds = scheduled.scheduledIds;
    } else {
      queue = generatePlannedQueue(snapshot, config, now, existing?.lastCategory || null);
    }

    const record: DeviceRecord = {
      deviceId,
      uid,
      friendUids,
      subscription: sub || existing?.subscription || null,
      oneSignalSubscriptionId:
        oneSignalSubscriptionId || existing?.oneSignalSubscriptionId || '',
      externalId: resolvedExternalId,
      scheduledIds,
      config,
      snapshot,
      nextFireAt: queue[0]?.fireAt || now + config.intervalMin * 60_000,
      lastSentAt: existing?.lastSentAt || 0,
      lastCategory: existing?.lastCategory || null,
      plannedQueue: queue,
      history: existing?.history || [],
      updatedAt: now,
    };
    store.devices[deviceId] = record;
    saveStore();

    res.json({
      ok: true,
      oneSignalConfigured: isOneSignalConfigured(),
      nextFireAt: record.nextFireAt,
      plannedQueue: record.plannedQueue,
      scheduledIds,
    });
  });

  router.post('/sync', async (req: Request, res: Response) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const deviceId =
      typeof body.deviceId === 'string'
        ? body.deviceId.trim().slice(0, 64)
        : '';
    if (!deviceId) {
      res.status(400).json({error: 'deviceId is required'});
      return;
    }

    const existing = store.devices[deviceId];
    const config = sanitizeConfig(body.config, existing?.config);
    const snapshot = sanitizeSnapshot(body.snapshot, existing?.snapshot);
    const uid =
      (typeof body.uid === 'string' ? body.uid.trim().slice(0, 128) : '') ||
      snapshot.uid ||
      existing?.uid ||
      '';
    const oneSignalSubscriptionId =
      (typeof body.oneSignalSubscriptionId === 'string'
        ? body.oneSignalSubscriptionId.trim().slice(0, 128)
        : '') || existing?.oneSignalSubscriptionId || '';
    const externalId =
      (typeof body.externalId === 'string' ? body.externalId.trim().slice(0, 128) : '') ||
      uid ||
      existing?.externalId ||
      `hour_${deviceId}`;
    const sub = validateSubscription(body.subscription) || existing?.subscription || null;

    const friendUids = Array.isArray(body.friendUids)
      ? body.friendUids
          .filter((x: unknown): x is string => typeof x === 'string' && x.trim().length > 0)
          .slice(0, 60)
      : (snapshot.friends || []).length
        ? (snapshot.friends || []).map((f) => f.uid)
        : existing?.friendUids || [];
    const now = Date.now();
    const forceReplan = Boolean(body.replan);
    const clientLastSent =
      typeof body.lastSentAt === 'number' && Number.isFinite(body.lastSentAt)
        ? body.lastSentAt
        : 0;
    const origin = typeof body.origin === 'string' ? body.origin : '';

    let queue = existing?.plannedQueue || [];
    let scheduledIds = existing?.scheduledIds || [];
    if (
      forceReplan ||
      !queue.length ||
      existing?.config.intervalMin !== config.intervalMin
    ) {
      const cancelIds = [
        ...(existing?.scheduledIds || []),
        ...(Array.isArray(body.cancelIds) ? body.cancelIds : []),
      ];
      if (cancelIds.length) {
        await cancelOneSignalNotifications(cancelIds);
      }
      if (
        config.enabled &&
        isOneSignalConfigured() &&
        (oneSignalSubscriptionId || externalId)
      ) {
        const scheduled = await scheduleOneSignalQueue({
          subscriptionId: oneSignalSubscriptionId,
          externalId,
          snapshot,
          config,
          lastCategory: existing?.lastCategory || null,
          origin,
        });
        queue = scheduled.queue;
        scheduledIds = scheduled.scheduledIds;
      } else {
        queue = generatePlannedQueue(snapshot, config, now, existing?.lastCategory || null);
        scheduledIds = [];
      }
    }

    const record: DeviceRecord = {
      deviceId,
      uid,
      friendUids,
      subscription: sub,
      oneSignalSubscriptionId,
      externalId,
      scheduledIds,
      config,
      snapshot,
      nextFireAt: queue[0]?.fireAt || now + config.intervalMin * 60_000,
      lastSentAt: Math.max(existing?.lastSentAt || 0, clientLastSent),
      lastCategory: existing?.lastCategory || null,
      plannedQueue: queue,
      history: existing?.history || [],
      updatedAt: now,
    };
    store.devices[deviceId] = record;
    saveStore();

    res.json({
      ok: true,
      oneSignalConfigured: isOneSignalConfigured(),
      hasSubscription: Boolean(record.subscription || record.oneSignalSubscriptionId),
      nextFireAt: record.nextFireAt,
      plannedQueue: record.plannedQueue,
      scheduledIds: record.scheduledIds || [],
      history: record.history,
    });
  });

  router.post('/unsubscribe', async (req: Request, res: Response) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const deviceId =
      typeof body.deviceId === 'string'
        ? body.deviceId.trim().slice(0, 64)
        : '';
    const existing = deviceId ? store.devices[deviceId] : undefined;
    const cancelIds = [
      ...(existing?.scheduledIds || []),
      ...(Array.isArray(body.cancelIds) ? body.cancelIds : []),
    ];
    if (cancelIds.length) {
      await cancelOneSignalNotifications(cancelIds);
    }
    if (existing) {
      existing.subscription = null;
      existing.scheduledIds = [];
      existing.config.enabled = false;
      saveStore();
    }
    res.json({ok: true});
  });

  router.post('/test', async (req: Request, res: Response) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const deviceId =
      typeof body.deviceId === 'string'
        ? body.deviceId.trim().slice(0, 64)
        : '';
    const forcedCat = VALID_CATEGORIES.includes(body.category)
      ? (body.category as NotifyCategory)
      : undefined;

    const existing = deviceId ? store.devices[deviceId] : undefined;
    const config = sanitizeConfig(body.config, existing?.config);
    const snapshot = sanitizeSnapshot(body.snapshot, existing?.snapshot);
    const payload =
      sanitizeCustomPayload(body.customPayload) ||
      buildRandomNotification(
        snapshot,
        config,
        forcedCat,
        existing?.lastCategory || null,
      );

    const origin = typeof body.origin === 'string' ? body.origin : '';
    const oneSignalSubscriptionId =
      (typeof body.oneSignalSubscriptionId === 'string'
        ? body.oneSignalSubscriptionId.trim().slice(0, 128)
        : '') || existing?.oneSignalSubscriptionId || '';
    const externalId =
      (typeof body.externalId === 'string' ? body.externalId.trim().slice(0, 128) : '') ||
      existing?.externalId ||
      '';
    const sub = validateSubscription(body.subscription) || existing?.subscription || null;

    if (oneSignalSubscriptionId || externalId) {
      if (!isOneSignalConfigured()) {
        res.json({
          ok: false,
          pushed: false,
          provider: 'onesignal',
          oneSignalConfigured: false,
          error: 'ONESIGNAL_APP_ID / ONESIGNAL_REST_API_KEY not set on server',
          payload,
        });
        return;
      }
      const osRes = await sendOneSignalPush({
        subscriptionIds: oneSignalSubscriptionId ? [oneSignalSubscriptionId] : undefined,
        externalIds: externalId ? [externalId] : undefined,
        payload,
        origin,
      });
      if (osRes.ok && existing) {
        existing.lastSentAt = Date.now();
        existing.lastCategory = payload.category;
        existing.history = [
          {
            at: existing.lastSentAt,
            category: payload.category,
            title: payload.title,
            body: payload.body,
          },
          ...existing.history,
        ].slice(0, 15);
        saveStore();
      }
      res.json({
        ok: osRes.ok,
        pushed: osRes.ok,
        provider: 'onesignal',
        oneSignalConfigured: true,
        error: osRes.error,
        payload,
      });
      return;
    }

    if (sub) {
      const result = await sendWebPushWithKeys(
        sub,
        payload as unknown as Record<string, unknown>,
        {
          publicKey: store.vapid.publicKey,
          privateKey: store.vapid.privateKey,
          subject: VAPID_SUBJECT,
        },
      );
      if (result.gone && existing) {
        existing.subscription = null;
        saveStore();
      }
      if (result.ok && existing) {
        existing.lastSentAt = Date.now();
        existing.lastCategory = payload.category;
        existing.history = [
          {
            at: existing.lastSentAt,
            category: payload.category,
            title: payload.title,
            body: payload.body,
          },
          ...existing.history,
        ].slice(0, 15);
        saveStore();
      }
      res.json({
        ok: result.ok,
        pushed: result.ok,
        provider: 'webpush',
        oneSignalConfigured: isOneSignalConfigured(),
        error: result.error,
        payload,
      });
      return;
    }

    res.json({
      ok: true,
      pushed: false,
      oneSignalConfigured: isOneSignalConfigured(),
      payload,
    });
  });

  router.get('/pull-random', (req: Request, res: Response) => {
    const deviceId =
      typeof req.query.deviceId === 'string'
        ? req.query.deviceId.trim().slice(0, 64)
        : '';
    const rec = deviceId ? store.devices[deviceId] : undefined;
    if (!rec || !rec.config.enabled) {
      res.json({skip: true});
      return;
    }
    const now = Date.now();
    if (isQuietAt(now, rec.config)) {
      res.json({skip: true});
      return;
    }
    if (now - rec.lastSentAt < rec.config.intervalMin * 0.6 * 60_000) {
      res.json({skip: true});
      return;
    }
    const payload = buildRandomNotification(
      rec.snapshot,
      rec.config,
      undefined,
      rec.lastCategory,
      now,
    );
    rec.lastSentAt = now;
    rec.lastCategory = payload.category;
    saveStore();
    res.json({skip: false, payload});
  });

  app.use('/api/push', router);

  const tickTimer = setInterval(async () => {
    const now = Date.now();
    let dirty = false;
    for (const rec of Object.values(store.devices)) {
      if (!rec.config.enabled || (!rec.subscription && !rec.oneSignalSubscriptionId)) continue;
      if (now < rec.nextFireAt) continue;

      if (isQuietAt(now, rec.config)) {
        rec.nextFireAt = advanceOutOfQuiet(now + 15 * 60_000, rec.config);
        dirty = true;
        continue;
      }

      if (now - rec.lastSentAt < rec.config.intervalMin * 0.55 * 60_000) {
        const nextQueue = generatePlannedQueue(
          rec.snapshot,
          rec.config,
          now,
          rec.lastCategory,
        );
        rec.plannedQueue = nextQueue;
        rec.nextFireAt = nextQueue[0]?.fireAt || now + rec.config.intervalMin * 60_000;
        dirty = true;
        continue;
      }

      const nextSlot = rec.plannedQueue.shift();
      const forcedCat = nextSlot?.category;
      const payload = buildRandomNotification(
        rec.snapshot,
        rec.config,
        forcedCat,
        rec.lastCategory,
        now,
      );

      const result = await sendDevicePush(rec, payload);
      if (result.ok) {
        rec.lastSentAt = now;
        rec.lastCategory = payload.category;
        rec.history = [
          {
            at: now,
            category: payload.category,
            title: payload.title,
            body: payload.body,
          },
          ...rec.history,
        ].slice(0, 15);
      }

      const freshQueue = generatePlannedQueue(
        rec.snapshot,
        rec.config,
        now,
        rec.lastCategory,
      );
      rec.plannedQueue = freshQueue;
      rec.nextFireAt = freshQueue[0]?.fireAt || now + rec.config.intervalMin * 60_000;
      dirty = true;
    }
    if (dirty) saveStore();
  }, 30_000);

  if (typeof tickTimer.unref === 'function') {
    tickTimer.unref();
  }
}
