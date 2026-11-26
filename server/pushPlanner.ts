import fs from 'node:fs';
import path from 'node:path';
import express, {type Express, type Request, type Response} from 'express';
import * as webpush from 'web-push';

export type NotifyCategory =
  | 'greeting'
  | 'stats'
  | 'task'
  | 'reminder'
  | 'motivation'
  | 'compete';

export interface NotifyConfig {
  enabled: boolean;
  intervalMin: number;
  categories: Record<NotifyCategory, boolean>;
  quietEnabled: boolean;
  quietStart: number;
  quietEnd: number;
  tzOffsetMin: number;
}

export interface PendingTaskSnap {
  title: string;
  subject?: string;
  minutes?: number;
}

export interface UpcomingTestSnap {
  name: string;
  daysLeft: number;
}

export interface FriendSnap {
  uid: string;
  displayName: string;
  username: string;
  xp?: number;
  streakDays?: number;
}

export interface StudySnapshot {
  uid?: string;
  username?: string;
  name?: string;
  xp?: number;
  questionsToday?: number;
  solvedToday?: number;
  practiceMinToday?: number;
  focusMinToday?: number;
  dailyGoalMin?: number;
  streak?: number;
  avgSec?: number;
  pendingTasks?: PendingTaskSnap[];
  totalTasksToday?: number;
  doneTasksToday?: number;
  upcomingTests?: UpcomingTestSnap[];
  onlineFriends?: FriendSnap[];
  friends?: FriendSnap[];
  lastPracticeAt?: number;
}

export interface PlannedSlot {
  id: string;
  category: NotifyCategory;
  fireAt: number;
  previewTitle: string;
  previewBody: string;
}

export interface PushSubscriptionData {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

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

const VALID_CATEGORIES: NotifyCategory[] = [
  'greeting',
  'stats',
  'task',
  'reminder',
  'motivation',
  'compete',
];

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'push-store.json');

let store: PushStore;

function defaultConfig(): NotifyConfig {
  return {
    enabled: false,
    intervalMin: 45,
    categories: {
      greeting: true,
      stats: true,
      task: true,
      reminder: true,
      motivation: true,
      compete: true,
    },
    quietEnabled: true,
    quietStart: 23,
    quietEnd: 7,
    tzOffsetMin: 0,
  };
}

function loadOrInitStore(): PushStore {
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
          vapid: raw.vapid,
          devices: raw.devices && typeof raw.devices === 'object' ? raw.devices : {},
          presence: raw.presence && typeof raw.presence === 'object' ? raw.presence : {},
        };
      }
    }
  } catch {
    // fallback to fresh store
  }

  const envPub = process.env.VAPID_PUBLIC_KEY;
  const envPriv = process.env.VAPID_PRIVATE_KEY;
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
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:notifications@hour.app',
  store.vapid.publicKey,
  store.vapid.privateKey,
);

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function sanitizeConfig(raw: unknown, prev?: NotifyConfig): NotifyConfig {
  const base = prev || defaultConfig();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  const catsRaw =
    r.categories && typeof r.categories === 'object'
      ? (r.categories as Record<string, unknown>)
      : {};
  const categories: Record<NotifyCategory, boolean> = {
    greeting:
      typeof catsRaw.greeting === 'boolean'
        ? catsRaw.greeting
        : base.categories.greeting,
    stats:
      typeof catsRaw.stats === 'boolean'
        ? catsRaw.stats
        : base.categories.stats,
    task:
      typeof catsRaw.task === 'boolean' ? catsRaw.task : base.categories.task,
    reminder:
      typeof catsRaw.reminder === 'boolean'
        ? catsRaw.reminder
        : base.categories.reminder,
    motivation:
      typeof catsRaw.motivation === 'boolean'
        ? catsRaw.motivation
        : base.categories.motivation,
    compete:
      typeof catsRaw.compete === 'boolean'
        ? catsRaw.compete
        : base.categories.compete ?? true,
  };
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : base.enabled,
    intervalMin:
      typeof r.intervalMin === 'number' && Number.isFinite(r.intervalMin)
        ? clamp(Math.round(r.intervalMin), 5, 720)
        : base.intervalMin,
    categories,
    quietEnabled:
      typeof r.quietEnabled === 'boolean' ? r.quietEnabled : base.quietEnabled,
    quietStart:
      typeof r.quietStart === 'number' && Number.isFinite(r.quietStart)
        ? clamp(Math.round(r.quietStart), 0, 23)
        : base.quietStart,
    quietEnd:
      typeof r.quietEnd === 'number' && Number.isFinite(r.quietEnd)
        ? clamp(Math.round(r.quietEnd), 0, 23)
        : base.quietEnd,
    tzOffsetMin:
      typeof r.tzOffsetMin === 'number' && Number.isFinite(r.tzOffsetMin)
        ? clamp(Math.round(r.tzOffsetMin), -840, 840)
        : base.tzOffsetMin,
  };
}

function sanitizeSnapshot(raw: unknown, prev?: StudySnapshot): StudySnapshot {
  const base = prev || {};
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  const cleanStr = (v: unknown, max: number): string =>
    typeof v === 'string' ? v.trim().slice(0, max) : '';
  const cleanNum = (v: unknown, def: number, max = 100000): number =>
    typeof v === 'number' && Number.isFinite(v) ? clamp(Math.round(v), 0, max) : def;

  const pendingTasks: PendingTaskSnap[] = Array.isArray(r.pendingTasks)
    ? r.pendingTasks
        .slice(0, 12)
        .map((t) => {
          const obj = t && typeof t === 'object' ? (t as Record<string, unknown>) : {};
          return {
            title: cleanStr(obj.title, 70),
            subject: cleanStr(obj.subject, 24),
            minutes: cleanNum(obj.minutes, 0, 600),
          };
        })
        .filter((t) => t.title.length > 0)
    : base.pendingTasks || [];

  const upcomingTests: UpcomingTestSnap[] = Array.isArray(r.upcomingTests)
    ? r.upcomingTests
        .slice(0, 6)
        .map((u) => {
          const obj = u && typeof u === 'object' ? (u as Record<string, unknown>) : {};
          return {
            name: cleanStr(obj.name, 60),
            daysLeft:
              typeof obj.daysLeft === 'number' && Number.isFinite(obj.daysLeft)
                ? clamp(Math.round(obj.daysLeft), 0, 999)
                : 0,
          };
        })
        .filter((u) => u.name.length > 0)
    : base.upcomingTests || [];

  const cleanFriendsList = (rawList: unknown, fallback: FriendSnap[]): FriendSnap[] =>
    Array.isArray(rawList)
      ? rawList
          .slice(0, 20)
          .map((f) => {
            const obj = f && typeof f === 'object' ? (f as Record<string, unknown>) : {};
            return {
              uid: cleanStr(obj.uid, 128),
              displayName: cleanStr(obj.displayName, 24),
              username: cleanStr(obj.username, 20),
              xp: cleanNum(obj.xp, 0, 10_000_000),
              streakDays: cleanNum(obj.streakDays, 0, 3650),
            };
          })
          .filter((f) => f.uid.length > 0 && f.displayName.length > 0)
      : fallback;

  return {
    uid: cleanStr(r.uid, 128) || base.uid || '',
    username: cleanStr(r.username, 20) || base.username || '',
    name: cleanStr(r.name, 24) || base.name || 'Friend',
    xp: cleanNum(r.xp, base.xp || 0, 10_000_000),
    questionsToday: cleanNum(r.questionsToday, base.questionsToday || 0),
    solvedToday: cleanNum(r.solvedToday, base.solvedToday || 0),
    practiceMinToday: cleanNum(r.practiceMinToday, base.practiceMinToday || 0),
    focusMinToday: cleanNum(r.focusMinToday, base.focusMinToday || 0),
    dailyGoalMin: cleanNum(r.dailyGoalMin, base.dailyGoalMin || 120, 1440),
    streak: cleanNum(r.streak, base.streak || 0, 3650),
    avgSec: cleanNum(r.avgSec, base.avgSec || 0, 3600),
    pendingTasks,
    totalTasksToday: cleanNum(r.totalTasksToday, base.totalTasksToday || 0, 200),
    doneTasksToday: cleanNum(r.doneTasksToday, base.doneTasksToday || 0, 200),
    upcomingTests,
    onlineFriends: cleanFriendsList(r.onlineFriends, base.onlineFriends || []),
    friends: cleanFriendsList(r.friends, base.friends || []),
    lastPracticeAt:
      typeof r.lastPracticeAt === 'number' && Number.isFinite(r.lastPracticeAt)
        ? r.lastPracticeAt
        : base.lastPracticeAt || 0,
  };
}

function validateSubscription(raw: unknown): PushSubscriptionData | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.endpoint !== 'string' || !r.endpoint.startsWith('https://')) {
    return null;
  }
  const keys = r.keys as Record<string, unknown> | undefined;
  if (
    !keys ||
    typeof keys.p256dh !== 'string' ||
    typeof keys.auth !== 'string' ||
    keys.p256dh.length < 16 ||
    keys.auth.length < 8
  ) {
    return null;
  }
  return {
    endpoint: r.endpoint,
    expirationTime: typeof r.expirationTime === 'number' ? r.expirationTime : null,
    keys: {
      p256dh: keys.p256dh,
      auth: keys.auth,
    },
  };
}

function getLocalHour(tsMs: number, tzOffsetMin: number): number {
  const localMs = tsMs - tzOffsetMin * 60_000;
  return new Date(localMs).getUTCHours();
}

function isQuietAt(tsMs: number, cfg: NotifyConfig): boolean {
  if (!cfg.quietEnabled) return false;
  const h = getLocalHour(tsMs, cfg.tzOffsetMin);
  if (cfg.quietStart === cfg.quietEnd) return false;
  if (cfg.quietStart > cfg.quietEnd) {
    return h >= cfg.quietStart || h < cfg.quietEnd;
  }
  return h >= cfg.quietStart && h < cfg.quietEnd;
}

function advanceOutOfQuiet(tsMs: number, cfg: NotifyConfig): number {
  if (!cfg.quietEnabled) return tsMs;
  let candidate = tsMs;
  for (let i = 0; i < 24; i++) {
    if (!isQuietAt(candidate, cfg)) return candidate;
    candidate += 60 * 60_000;
  }
  return candidate;
}

function pickCategory(
  cfg: NotifyConfig,
  lastCategory: NotifyCategory | null,
): NotifyCategory {
  const enabled = VALID_CATEGORIES.filter((c) => cfg.categories[c]);
  const pool = enabled.length ? enabled : VALID_CATEGORIES;
  const filtered = pool.length > 1 ? pool.filter((c) => c !== lastCategory) : pool;
  return filtered[Math.floor(Math.random() * filtered.length)];
}

export function buildRandomNotification(
  snapshot: StudySnapshot,
  config: NotifyConfig,
  forcedCategory?: NotifyCategory,
  lastCategory?: NotifyCategory | null,
  atMs: number = Date.now(),
): {
  title: string;
  body: string;
  category: NotifyCategory;
  target: string;
  tag: string;
  actions: Array<{action: string; title: string}>;
} {
  const category = forcedCategory || pickCategory(config, lastCategory || null);
  const name = (snapshot.name || 'Friend').trim() || 'Friend';
  const hour = getLocalHour(atMs, config.tzOffsetMin);
  const qToday = snapshot.questionsToday || 0;
  const solvedToday = snapshot.solvedToday || 0;
  const pMin = snapshot.practiceMinToday || 0;
  const fMin = snapshot.focusMinToday || 0;
  const goal = snapshot.dailyGoalMin || 120;
  const streak = snapshot.streak || 0;
  const pending = snapshot.pendingTasks || [];
  const tests = snapshot.upcomingTests || [];
  const totalToday = snapshot.totalTasksToday || 0;
  const doneToday = snapshot.doneTasksToday || 0;

  const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

  if (category === 'greeting') {
    let options: Array<{title: string; body: string; target: string}>;
    if (hour >= 5 && hour < 12) {
      options = [
        {
          title: `Good morning, ${name} ☀️`,
          body: pending.length
            ? `You have ${pending.length} task${pending.length > 1 ? 's' : ''} lined up today. Start with "${pending[0].title}".`
            : 'Fresh morning, clean slate. Tap to start a 25-minute Focus session.',
          target: pending.length ? 'plan' : 'focus',
        },
        {
          title: `Morning kickoff · ${name}`,
          body:
            streak > 0
              ? `Day ${streak + 1} awaits! Knock out your first 5 questions early.`
              : 'Win the morning with one crisp 20-minute question sprint.',
          target: 'home',
        },
      ];
    } else if (hour >= 12 && hour < 17) {
      options = [
        {
          title: `Afternoon check-in, ${name} 👋`,
          body:
            qToday > 0
              ? `${qToday} questions logged so far today (${pMin} min). Keep the rhythm alive!`
              : 'Midday reset: open Hour and log a quick 15-minute set.',
          target: qToday > 0 ? 'home' : 'focus',
        },
        {
          title: `Hey ${name}, beat the afternoon slump ⚡`,
          body: pending.length
            ? `Next up in Planner: ${pending[0].title}${pending[0].minutes ? ` (${pending[0].minutes}m)` : ''}.`
            : 'Take 5 slow breaths, hydrate, and dive into one focused block.',
          target: pending.length ? 'plan' : 'focus',
        },
      ];
    } else if (hour >= 17 && hour < 22) {
      options = [
        {
          title: `Good evening, ${name} 🌆`,
          body:
            fMin < goal
              ? `${Math.max(5, goal - fMin)} min left to hit your ${goal}m daily focus goal. Strong finish!`
              : `Daily goal smashed (${fMin}/${goal}m)! Review a quick task or test log.`,
          target: 'stats',
        },
        {
          title: `Evening sprint check, ${name}`,
          body: pending.length
            ? `${pending.length} planner task${pending.length > 1 ? 's' : ''} still open today — clear one before dinner!`
            : 'Great evening energy — practice leaving tricky questions on time.',
          target: pending.length ? 'plan' : 'home',
        },
      ];
    } else {
      options = [
        {
          title: `Night owl mode, ${name} 🌙`,
          body: `Today's wrap: ${qToday} questions & ${fMin}m focus. Light revision beats burning out!`,
          target: 'stats',
        },
        {
          title: `Evening review, ${name} ✨`,
          body: 'Plan tomorrow’s top 3 tasks in Daily Planner so morning starts effortless.',
          target: 'plan',
        },
      ];
    }
    const chosen = pick(options);
    return {
      ...chosen,
      category,
      tag: 'hour-greeting',
      actions: [
        {action: 'open-' + chosen.target, title: 'Open Hour'},
        {action: 'open-focus', title: 'Focus Now'},
      ],
    };
  }

  if (category === 'stats') {
    const pct = Math.min(100, Math.round((fMin / Math.max(1, goal)) * 100));
    const solvePct = qToday > 0 ? Math.round((solvedToday / qToday) * 100) : 0;
    const options = [
      {
        title: `📊 Today's Pulse · ${qToday} questions`,
        body:
          qToday > 0
            ? `${solvedToday} solved (${solvePct}% solve rate) in ${pMin}m practice time.${snapshot.avgSec ? ` Avg ${snapshot.avgSec}s/question.` : ''}`
            : `0 questions recorded yet today — start Question #1 to light up today's bar!`,
        target: 'stats',
      },
      {
        title: `🔥 ${streak}-Day Study Streak`,
        body:
          streak > 0
            ? `You're on a ${streak}-day streak, ${name}! Keep your momentum rolling today.`
            : `Start a new streak today, ${name} — just one completed session counts!`,
        target: 'stats',
      },
      {
        title: `🎯 Focus Goal: ${pct}% (${fMin}/${goal} min)`,
        body:
          fMin >= goal
            ? `Goal reached for today! Every extra minute is pure bonus XP.`
            : `${goal - fMin} minutes left to complete today's ${goal}m focus target.`,
        target: 'focus',
      },
    ];
    const chosen = pick(options);
    return {
      ...chosen,
      category,
      tag: 'hour-stats',
      actions: [
        {action: 'open-stats', title: 'View Stats'},
        {action: 'open-home', title: 'Practice'},
      ],
    };
  }

  if (category === 'task') {
    if (pending.length > 0) {
      const task = pick(pending);
      const subjPart = task.subject ? `[${task.subject}] ` : '';
      const minPart = task.minutes ? ` · ${task.minutes} min planned` : '';
      const bodies = [
        `${subjPart}${task.title}${minPart}. Tap to launch your timer!`,
        `Up next: ${subjPart}${task.title}${minPart}. Finish this to stay on track.`,
        `Planner nudge (${pending.length} left today): ${task.title}${minPart}.`,
      ];
      return {
        title: `📋 Task Reminder · ${name}`,
        body: pick(bodies),
        category,
        target: 'plan',
        tag: 'hour-task',
        actions: [
          {action: 'open-plan', title: 'Open Planner'},
          {action: 'open-focus', title: 'Start Focus'},
        ],
      };
    }
    const allDone = totalToday > 0 && doneToday >= totalToday;
    return {
      title: allDone ? `✅ All ${doneToday} tasks complete!` : `🗓️ Daily Planner check`,
      body: allDone
        ? `Brilliant discipline, ${name}! Add bonus revision or review your stats.`
        : `No tasks queued for today yet — add 3 crisp targets in Daily Planner.`,
      category,
      target: 'plan',
      tag: 'hour-task',
      actions: [
        {action: 'open-plan', title: 'Open Planner'},
        {action: 'open-stats', title: 'View Stats'},
      ],
    };
  }

  if (category === 'reminder') {
    const reminders: Array<{title: string; body: string; target: string}> = [
      {
        title: '💧 Hydration & Posture Check',
        body: 'Sip water, relax your shoulders, and look 20ft away for 20 seconds.',
        target: 'home',
      },
      {
        title: '⏱️ Leave-It Discipline Reminder',
        body: 'At the checkpoint: if you cannot state the next step in 5s, leave it and protect your score.',
        target: 'home',
      },
      {
        title: '📖 Mistakes Notebook Cue',
        body: 'Quick reminder: revisit the questions you skipped or left on time today.',
        target: 'stats',
      },
    ];
    if (tests.length > 0) {
      const t = tests[0];
      reminders.unshift({
        title: `🎯 Upcoming Test: ${t.name}`,
        body:
          t.daysLeft === 0
            ? `${t.name} is TODAY! Trust your pacing and leave stuck questions fast.`
            : `${t.name} is in ${t.daysLeft} day${t.daysLeft > 1 ? 's' : ''}. Do a timed sprint now.`,
        target: 'tests',
      });
    }
    const chosen = pick(reminders);
    return {
      ...chosen,
      category,
      tag: 'hour-reminder',
      actions: [
        {action: 'open-' + chosen.target, title: 'Open Hour'},
        {action: 'open-focus', title: 'Start Focus'},
      ],
    };
  }

  if (category === 'compete') {
    const onlineFriends = snapshot.onlineFriends || [];
    const allFriends = snapshot.friends || [];
    if (onlineFriends.length > 0) {
      const f = pick(onlineFriends);
      const opts = [
        {
          title: `🟢 ${f.displayName} is online right now!`,
          body: `${f.displayName} (@${f.username}) is active in Hour. Hop online and compete in a 1v1 sprint!`,
          target: 'arena-duel',
        },
        {
          title: `⚔️ ${f.displayName} is studying live`,
          body: `Don’t let @${f.username} pull ahead${f.xp ? ` (${f.xp.toLocaleString()} XP)` : ''}. Come online and race!`,
          target: 'arena-friends',
        },
      ];
      const chosen = pick(opts);
      return {
        ...chosen,
        category: 'compete',
        tag: 'hour-compete-online',
        actions: [
          {action: 'open-arena-duel', title: '⚔️ Compete'},
          {action: 'open-arena-friends', title: '👥 Friends'},
        ],
      };
    }
    if (allFriends.length > 0) {
      const f = pick(allFriends);
      const opts = [
        {
          title: `⚔️ Challenge ${f.displayName} (@${f.username})`,
          body: `${f.displayName} has ${(f.xp || 0).toLocaleString()} XP${f.streakDays ? ` · 🔥${f.streakDays}d streak` : ''}. Come online and overtake them!`,
          target: 'arena-friends',
        },
        {
          title: `🏆 Friends Leaderboard Check`,
          body: `See your friends’ live online & last-seen status — log one crisp sprint to climb ahead, ${name}!`,
          target: 'arena-leaderboard',
        },
      ];
      const chosen = pick(opts);
      return {
        ...chosen,
        category: 'compete',
        tag: 'hour-compete-friend',
        actions: [
          {action: 'open-arena-friends', title: '👥 Friends'},
          {action: 'open-arena-leaderboard', title: '🏆 Rankings'},
        ],
      };
    }
    return {
      title: `🏆 Ready to compete, ${name}?`,
      body: 'Open Hour Arena to see active players, add rivals, and start a 1v1 focus duel.',
      category: 'compete',
      target: 'arena-friends',
      tag: 'hour-compete',
      actions: [
        {action: 'open-arena-friends', title: 'Open Arena'},
        {action: 'open-focus', title: 'Start Focus'},
      ],
    };
  }

  // motivation
  const quotes = [
    {
      title: '⚡ Speed beats stubbornness',
      body: `One stuck question can cost 3 easy marks. Practice letting go on time, ${name}!`,
      target: 'home',
    },
    {
      title: '🎯 Ready for a clean Focus block?',
      body: 'Silence distractions for 25 minutes inside Focus Sanctuary.',
      target: 'focus',
    },
    {
      title: '🧠 1% sharper every day',
      body: 'Consistency compounds quietly. Open Hour for a quick 10-question timing drill.',
      target: 'home',
    },
    {
      title: '🏆 Challenge yourself in Arena',
      body: 'Start a quick Focus or Question Sprint and stack XP today.',
      target: 'focus',
    },
  ];
  const chosen = pick(quotes);
  return {
    ...chosen,
    category: 'motivation',
    tag: 'hour-motivation',
    actions: [
      {action: 'open-' + chosen.target, title: 'Let’s Go'},
      {action: 'open-plan', title: 'View Plan'},
    ],
  };
}

function generatePlannedQueue(
  snapshot: StudySnapshot,
  config: NotifyConfig,
  startFromMs: number,
  lastCategory: NotifyCategory | null,
  count: number = 4,
): PlannedSlot[] {
  const queue: PlannedSlot[] = [];
  let cursor = startFromMs;
  let prevCat = lastCategory;
  for (let i = 0; i < count; i++) {
    const jitter = 0.78 + Math.random() * 0.44;
    const stepMs = Math.max(5, config.intervalMin) * jitter * 60_000;
    cursor = advanceOutOfQuiet(cursor + stepMs, config);
    const cat = pickCategory(config, prevCat);
    const built = buildRandomNotification(snapshot, config, cat, prevCat, cursor);
    queue.push({
      id: `slot-${i}-${Math.round(cursor)}`,
      category: built.category,
      fireAt: Math.round(cursor),
      previewTitle: built.title,
      previewBody: built.body,
    });
    prevCat = built.category;
  }
  return queue;
}

async function sendWebPush(
  record: DeviceRecord,
  payload: Record<string, unknown>,
): Promise<{ok: boolean; gone?: boolean; error?: string}> {
  if (!record.subscription) {
    return {ok: false, error: 'no_subscription'};
  }
  try {
    await webpush.sendNotification(
      record.subscription as unknown as webpush.PushSubscription,
      JSON.stringify(payload),
      {TTL: 3600, urgency: 'high'},
    );
    return {ok: true};
  } catch (err: unknown) {
    const status =
      err && typeof err === 'object' && 'statusCode' in err
        ? Number((err as {statusCode?: number}).statusCode)
        : 0;
    if (status === 404 || status === 410) {
      record.subscription = null;
      saveStore();
      return {ok: false, gone: true, error: 'subscription_expired'};
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'push_failed',
    };
  }
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

  function buildFriendOnlinePayload(params: {
    uid: string;
    username: string;
    displayName: string;
    xp?: number;
    streakDays?: number;
  }) {
    const disp = params.displayName || params.username || 'Your friend';
    const uname = params.username ? `@${params.username}` : disp;
    const xpTxt = params.xp ? ` (${params.xp.toLocaleString()} XP)` : '';
    const streakTxt = params.streakDays ? ` · 🔥${params.streakDays}d streak` : '';
    const variants = [
      {
        title: `🟢 ${disp} just came online!`,
        body: `${uname} is studying right now${streakTxt}. Come online and compete in a 1v1 sprint!`,
      },
      {
        title: `⚔️ ${disp} is ready to compete!`,
        body: `${disp} just hopped onto Hour${xpTxt}. Jump into Arena and challenge them now!`,
      },
      {
        title: `🔥 Rival Alert · ${disp} is online`,
        body: `Don’t miss out — come online and race ${uname} in Hour Arena!`,
      },
    ];
    const picked = variants[Math.floor(Math.random() * variants.length)];
    return {
      title: picked.title,
      body: picked.body,
      category: 'compete' as NotifyCategory,
      target: 'arena-friends',
      fromUid: params.uid,
      fromDisplayName: disp,
      fromUsername: params.username,
      tag: `hour-friend-online-${params.uid}`,
      actions: [
        {action: 'open-arena-duel', title: '⚔️ Compete'},
        {action: 'open-arena-friends', title: '👥 Friends'},
      ],
    };
  }

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
      for (const fUid of friendSet) {
        const pairKey = `${uid}->${fUid}`;
        const lastAlert = friendAlertCooldown.get(pairKey) || 0;
        if (now - lastAlert < 5 * 60_000) continue;
        friendAlertCooldown.set(pairKey, now);

        emitSseToUser(fUid, 'friend-online', payload);
        notifiedFriends++;
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
          sendWebPush(rec, payload).then((r) => {
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

  router.post('/subscribe', (req: Request, res: Response) => {
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
    if (!sub) {
      res.status(400).json({error: 'Valid HTTPS push subscription is required'});
      return;
    }

    const existing = store.devices[deviceId];
    const config = sanitizeConfig(body.config, existing?.config);
    config.enabled = typeof body.config?.enabled === 'boolean' ? body.config.enabled : true;
    const snapshot = sanitizeSnapshot(body.snapshot, existing?.snapshot);
    const uid =
      (typeof body.uid === 'string' ? body.uid.trim().slice(0, 128) : '') ||
      snapshot.uid ||
      existing?.uid ||
      '';
    const friendUids = Array.isArray(body.friendUids)
      ? body.friendUids
          .filter((x: unknown): x is string => typeof x === 'string' && x.trim().length > 0)
          .slice(0, 60)
      : existing?.friendUids || (snapshot.friends || []).map((f) => f.uid);
    const now = Date.now();
    const queue = generatePlannedQueue(snapshot, config, now, existing?.lastCategory || null);

    const record: DeviceRecord = {
      deviceId,
      uid,
      friendUids,
      subscription: sub,
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
      nextFireAt: record.nextFireAt,
      plannedQueue: record.plannedQueue,
    });
  });

  router.post('/sync', (req: Request, res: Response) => {
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

    let queue = existing?.plannedQueue || [];
    if (
      forceReplan ||
      !queue.length ||
      existing?.config.intervalMin !== config.intervalMin
    ) {
      queue = generatePlannedQueue(snapshot, config, now, existing?.lastCategory || null);
    }

    const record: DeviceRecord = {
      deviceId,
      uid,
      friendUids,
      subscription: existing?.subscription || null,
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
      hasSubscription: Boolean(record.subscription),
      nextFireAt: record.nextFireAt,
      plannedQueue: record.plannedQueue,
      history: record.history,
    });
  });

  router.post('/unsubscribe', (req: Request, res: Response) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const deviceId =
      typeof body.deviceId === 'string'
        ? body.deviceId.trim().slice(0, 64)
        : '';
    if (deviceId && store.devices[deviceId]) {
      store.devices[deviceId].subscription = null;
      store.devices[deviceId].config.enabled = false;
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
    const payload = buildRandomNotification(
      snapshot,
      config,
      forcedCat,
      existing?.lastCategory || null,
    );

    if (existing?.subscription) {
      const result = await sendWebPush(existing, payload);
      if (result.ok) {
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
      res.json({ok: result.ok, pushed: result.ok, error: result.error, payload});
      return;
    }

    res.json({ok: true, pushed: false, payload});
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

  // Background push scheduler (checks every 30 seconds for due Android push alerts)
  const tickTimer = setInterval(async () => {
    const now = Date.now();
    let dirty = false;
    for (const rec of Object.values(store.devices)) {
      if (!rec.config.enabled || !rec.subscription) continue;
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

      const result = await sendWebPush(rec, payload);
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
