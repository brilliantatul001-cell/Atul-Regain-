import {
  buildFriendOnlinePayload,
  buildRandomNotification,
  cancelOneSignalNotifications,
  generatePlannedQueue,
  getEnvVapidKeys,
  isOneSignalConfigured,
  sanitizeConfig,
  sanitizeCustomPayload,
  sanitizeSnapshot,
  scheduleOneSignalQueue,
  sendOneSignalPush,
  sendWebPushWithKeys,
  validateSubscription,
  VALID_CATEGORIES,
  type NotifyCategory,
} from '../../server/pushCore';

interface ApiRequest {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
}

interface ApiResponse {
  status: (code: number) => ApiResponse;
  json: (data: unknown) => void;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
}

function parseAction(req: ApiRequest): string {
  const qAction = req.query?.action;
  if (typeof qAction === 'string' && qAction.trim()) {
    return qAction.trim().toLowerCase();
  }
  if (Array.isArray(qAction) && qAction[0]) {
    return String(qAction[0]).trim().toLowerCase();
  }
  const rawUrl = (req.url || '').split('?')[0];
  const segs = rawUrl.split('/').filter(Boolean);
  return (segs[segs.length - 1] || '').toLowerCase();
}

function parseBody(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === 'object') {
    return raw as Record<string, unknown>;
  }
  return {};
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const action = parseAction(req);
  const body = parseBody(req.body);
  const vapid = getEnvVapidKeys();
  const osConfigured = isOneSignalConfigured();

  const reqHost = typeof req.headers?.host === 'string' ? req.headers.host : '';
  const reqProto =
    typeof req.headers?.['x-forwarded-proto'] === 'string'
      ? req.headers['x-forwarded-proto']
      : 'https';
  const defaultOrigin = reqHost ? `${reqProto}://${reqHost}` : '';

  if (action === 'status') {
    res.status(200).json({
      ok: true,
      mode: 'vercel',
      oneSignalConfigured: osConfigured,
      webPushConfigured: Boolean(vapid),
    });
    return;
  }

  if (action === 'vapid-public-key') {
    res.status(200).json({
      publicKey: vapid?.publicKey || '',
      configured: Boolean(vapid),
    });
    return;
  }

  if (action === 'presence' && req.method === 'GET') {
    res.status(200).json({serverNow: Date.now(), presence: {}});
    return;
  }

  if (action === 'presence' && req.method === 'POST') {
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
    const friendUids = Array.isArray(body.friendUids)
      ? body.friendUids
          .filter((id): id is string => typeof id === 'string' && id.trim().length > 0 && id !== uid)
          .map((id) => id.trim().slice(0, 128))
          .slice(0, 60)
      : [];

    let notifiedFriends = 0;
    if (isOnline && body.notifyFriends === true && friendUids.length > 0 && osConfigured) {
      const payload = buildFriendOnlinePayload({
        uid,
        username,
        displayName,
        xp: typeof body.xp === 'number' ? Math.max(0, Math.round(body.xp)) : undefined,
        streakDays:
          typeof body.streakDays === 'number' ? Math.max(0, Math.round(body.streakDays)) : undefined,
      });
      const r = await sendOneSignalPush({
        externalIds: friendUids,
        payload,
        origin: typeof body.origin === 'string' ? body.origin : defaultOrigin,
      });
      if (r.ok) notifiedFriends = friendUids.length;
    }

    res.status(200).json({
      ok: true,
      notifiedFriends,
    });
    return;
  }

  if (action === 'subscribe') {
    const deviceId =
      typeof body.deviceId === 'string' ? body.deviceId.trim().slice(0, 64) : '';
    if (!deviceId) {
      res.status(400).json({error: 'deviceId is required'});
      return;
    }

    const cancelIds = Array.isArray(body.cancelIds)
      ? body.cancelIds.filter((x): x is string => typeof x === 'string')
      : [];
    if (cancelIds.length) {
      await cancelOneSignalNotifications(cancelIds);
    }

    const config = sanitizeConfig(body.config);
    config.enabled =
      typeof (body.config as Record<string, unknown> | undefined)?.enabled === 'boolean'
        ? Boolean((body.config as Record<string, unknown>).enabled)
        : true;
    const snapshot = sanitizeSnapshot(body.snapshot);
    const uid =
      (typeof body.uid === 'string' ? body.uid.trim().slice(0, 128) : '') ||
      snapshot.uid ||
      '';
    const oneSignalSubscriptionId =
      typeof body.oneSignalSubscriptionId === 'string'
        ? body.oneSignalSubscriptionId.trim().slice(0, 128)
        : '';
    const externalId =
      (typeof body.externalId === 'string' ? body.externalId.trim().slice(0, 128) : '') ||
      uid ||
      `hour_${deviceId}`;
    const origin = typeof body.origin === 'string' ? body.origin : defaultOrigin;

    const scheduled =
      config.enabled && osConfigured && (oneSignalSubscriptionId || externalId)
        ? await scheduleOneSignalQueue({
            subscriptionId: oneSignalSubscriptionId || undefined,
            externalId,
            snapshot,
            config,
            lastCategory: null,
            origin,
          })
        : {
            scheduledIds: [],
            queue: generatePlannedQueue(snapshot, config, Date.now(), null),
          };

    res.status(200).json({
      ok: true,
      oneSignalConfigured: osConfigured,
      webPushConfigured: Boolean(vapid),
      nextFireAt: scheduled.queue[0]?.fireAt || Date.now() + config.intervalMin * 60_000,
      plannedQueue: scheduled.queue,
      scheduledIds: scheduled.scheduledIds,
    });
    return;
  }

  if (action === 'sync') {
    const deviceId =
      typeof body.deviceId === 'string' ? body.deviceId.trim().slice(0, 64) : '';
    if (!deviceId) {
      res.status(400).json({error: 'deviceId is required'});
      return;
    }
    const config = sanitizeConfig(body.config);
    const snapshot = sanitizeSnapshot(body.snapshot);
    const uid =
      (typeof body.uid === 'string' ? body.uid.trim().slice(0, 128) : '') ||
      snapshot.uid ||
      '';
    const oneSignalSubscriptionId =
      typeof body.oneSignalSubscriptionId === 'string'
        ? body.oneSignalSubscriptionId.trim().slice(0, 128)
        : '';
    const externalId =
      (typeof body.externalId === 'string' ? body.externalId.trim().slice(0, 128) : '') ||
      uid ||
      `hour_${deviceId}`;
    const sub = validateSubscription(body.subscription);
    const origin = typeof body.origin === 'string' ? body.origin : defaultOrigin;
    const replan = Boolean(body.replan);

    let scheduledIds: string[] = [];
    let queue = generatePlannedQueue(snapshot, config, Date.now(), null);

    if (replan) {
      const cancelIds = Array.isArray(body.cancelIds)
        ? body.cancelIds.filter((x): x is string => typeof x === 'string')
        : [];
      if (cancelIds.length) {
        await cancelOneSignalNotifications(cancelIds);
      }
      if (config.enabled && osConfigured && (oneSignalSubscriptionId || externalId)) {
        const scheduled = await scheduleOneSignalQueue({
          subscriptionId: oneSignalSubscriptionId || undefined,
          externalId,
          snapshot,
          config,
          lastCategory: null,
          origin,
        });
        queue = scheduled.queue;
        scheduledIds = scheduled.scheduledIds;
      }
    }

    res.status(200).json({
      ok: true,
      oneSignalConfigured: osConfigured,
      webPushConfigured: Boolean(vapid),
      hasSubscription: Boolean(sub || oneSignalSubscriptionId),
      nextFireAt: queue[0]?.fireAt || Date.now() + config.intervalMin * 60_000,
      plannedQueue: queue,
      scheduledIds,
      history: [],
    });
    return;
  }

  if (action === 'unsubscribe') {
    const cancelIds = Array.isArray(body.cancelIds)
      ? body.cancelIds.filter((x): x is string => typeof x === 'string')
      : [];
    if (cancelIds.length) {
      await cancelOneSignalNotifications(cancelIds);
    }
    res.status(200).json({ok: true});
    return;
  }

  if (action === 'test') {
    const forcedCat = VALID_CATEGORIES.includes(body.category as NotifyCategory)
      ? (body.category as NotifyCategory)
      : undefined;
    const config = sanitizeConfig(body.config);
    const snapshot = sanitizeSnapshot(body.snapshot);
    const payload =
      sanitizeCustomPayload(body.customPayload) ||
      buildRandomNotification(snapshot, config, forcedCat, null);

    const origin = typeof body.origin === 'string' ? body.origin : defaultOrigin;
    const oneSignalSubscriptionId =
      typeof body.oneSignalSubscriptionId === 'string'
        ? body.oneSignalSubscriptionId.trim().slice(0, 128)
        : '';
    const externalId =
      typeof body.externalId === 'string' ? body.externalId.trim().slice(0, 128) : '';
    const sub = validateSubscription(body.subscription);

    if (oneSignalSubscriptionId || externalId) {
      if (!osConfigured) {
        res.status(200).json({
          ok: false,
          pushed: false,
          provider: 'onesignal',
          oneSignalConfigured: false,
          webPushConfigured: Boolean(vapid),
          error: 'ONESIGNAL_APP_ID / ONESIGNAL_REST_API_KEY missing in Vercel Environment Variables',
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
      res.status(200).json({
        ok: osRes.ok,
        pushed: osRes.ok,
        provider: 'onesignal',
        oneSignalConfigured: true,
        webPushConfigured: Boolean(vapid),
        error: osRes.error,
        payload,
      });
      return;
    }

    if (sub && vapid) {
      const wpRes = await sendWebPushWithKeys(
        sub,
        payload as unknown as Record<string, unknown>,
        vapid,
      );
      res.status(200).json({
        ok: wpRes.ok,
        pushed: wpRes.ok,
        provider: 'webpush',
        oneSignalConfigured: osConfigured,
        webPushConfigured: true,
        error: wpRes.error,
        payload,
      });
      return;
    }

    res.status(200).json({
      ok: true,
      pushed: false,
      oneSignalConfigured: osConfigured,
      webPushConfigured: Boolean(vapid),
      payload,
    });
    return;
  }

  if (action === 'pull-random') {
    const config = sanitizeConfig(undefined);
    const snapshot = sanitizeSnapshot(undefined);
    const payload = buildRandomNotification(snapshot, config, undefined, null, Date.now());
    res.status(200).json({skip: false, payload});
    return;
  }

  res.status(404).json({error: `Unknown push endpoint: ${action}`});
}
