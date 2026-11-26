import * as webpushNs from 'web-push';

const webpush = (
  (webpushNs as unknown as {default?: typeof webpushNs}).default ?? webpushNs
) as typeof webpushNs;

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

export interface NotificationPayload {
  title: string;
  body: string;
  category: NotifyCategory;
  target: string;
  tag: string;
  actions: Array<{action: string; title: string}>;
  fromUid?: string;
  fromDisplayName?: string;
  fromUsername?: string;
}

export const VALID_CATEGORIES: NotifyCategory[] = [
  'greeting',
  'stats',
  'task',
  'reminder',
  'motivation',
  'compete',
];

export function defaultConfig(): NotifyConfig {
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

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function sanitizeConfig(raw: unknown, prev?: NotifyConfig): NotifyConfig {
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

export function sanitizeSnapshot(raw: unknown, prev?: StudySnapshot): StudySnapshot {
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

export function validateSubscription(raw: unknown): PushSubscriptionData | null {
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

export function getLocalHour(tsMs: number, tzOffsetMin: number): number {
  const localMs = tsMs - tzOffsetMin * 60_000;
  return new Date(localMs).getUTCHours();
}

export function isQuietAt(tsMs: number, cfg: NotifyConfig): boolean {
  if (!cfg.quietEnabled) return false;
  const h = getLocalHour(tsMs, cfg.tzOffsetMin);
  if (cfg.quietStart === cfg.quietEnd) return false;
  if (cfg.quietStart > cfg.quietEnd) {
    return h >= cfg.quietStart || h < cfg.quietEnd;
  }
  return h >= cfg.quietStart && h < cfg.quietEnd;
}

export function advanceOutOfQuiet(tsMs: number, cfg: NotifyConfig): number {
  if (!cfg.quietEnabled) return tsMs;
  let candidate = tsMs;
  for (let i = 0; i < 24; i++) {
    if (!isQuietAt(candidate, cfg)) return candidate;
    candidate += 60 * 60_000;
  }
  return candidate;
}

export function pickCategory(
  cfg: NotifyConfig,
  lastCategory: NotifyCategory | null,
): NotifyCategory {
  const enabled = VALID_CATEGORIES.filter((c) => cfg.categories[c]);
  const pool = enabled.length ? enabled : VALID_CATEGORIES;
  const filtered = pool.length > 1 ? pool.filter((c) => c !== lastCategory) : pool;
  return filtered[Math.floor(Math.random() * filtered.length)];
}

export function sanitizeCustomPayload(raw: unknown): NotificationPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const title = typeof r.title === 'string' ? r.title.trim().slice(0, 120) : '';
  const body = typeof r.body === 'string' ? r.body.trim().slice(0, 280) : '';
  if (!title && !body) return null;
  const cat = VALID_CATEGORIES.includes(r.category as NotifyCategory)
    ? (r.category as NotifyCategory)
    : 'reminder';
  const target =
    typeof r.target === 'string' && r.target.trim()
      ? r.target.trim().slice(0, 40)
      : 'home';
  const tag =
    typeof r.tag === 'string' && r.tag.trim()
      ? r.tag.trim().slice(0, 64)
      : `hour-${cat}`;
  return {
    title: title || 'Hour',
    body,
    category: cat,
    target,
    tag,
    actions: [{action: 'open-' + target, title: 'Open Hour'}],
  };
}

export function buildRandomNotification(
  snapshot: StudySnapshot,
  config: NotifyConfig,
  forcedCategory?: NotifyCategory,
  lastCategory?: NotifyCategory | null,
  atMs: number = Date.now(),
): NotificationPayload {
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

export function buildFriendOnlinePayload(params: {
  uid: string;
  username: string;
  displayName: string;
  xp?: number;
  streakDays?: number;
}): NotificationPayload {
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
    category: 'compete',
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

export function generatePlannedQueue(
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

export function getOneSignalEnv(): {appId: string; restApiKey: string} | null {
  const appId = (process.env.ONESIGNAL_APP_ID || '').trim();
  const restApiKey = (process.env.ONESIGNAL_REST_API_KEY || '').trim();
  if (!appId || !restApiKey) return null;
  return {appId, restApiKey};
}

export function isOneSignalConfigured(): boolean {
  return Boolean(getOneSignalEnv());
}

export function getEnvVapidKeys(): {publicKey: string; privateKey: string; subject: string} | null {
  const publicKey = (process.env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = (process.env.VAPID_PRIVATE_KEY || '').trim();
  if (!publicKey || !privateKey) return null;
  return {
    publicKey,
    privateKey,
    subject: (process.env.VAPID_SUBJECT || 'mailto:notifications@hour.app').trim(),
  };
}

export async function sendOneSignalPush(params: {
  subscriptionIds?: string[];
  externalIds?: string[];
  payload: NotificationPayload;
  sendAfterMs?: number;
  origin?: string;
}): Promise<{ok: boolean; id?: string; recipients?: number; error?: string; notConfigured?: boolean}> {
  const env = getOneSignalEnv();
  if (!env) {
    return {ok: false, notConfigured: true, error: 'OneSignal env vars not configured'};
  }

  const subIds = (params.subscriptionIds || []).map((s) => s.trim()).filter(Boolean);
  const extIds = (params.externalIds || [])
    .map((s) => s.trim().slice(0, 128))
    .filter((s) => s && !['null', 'undefined', 'NA', '0', 'ANONYMOUS'].includes(s));

  if (!subIds.length && !extIds.length) {
    return {ok: false, error: 'No OneSignal target ID'};
  }

  const cleanOrigin = (params.origin || '').replace(/\/+$/, '');
  const targetUrl = cleanOrigin
    ? `${cleanOrigin}/?open=${encodeURIComponent(params.payload.target || 'home')}`
    : undefined;

  const body: Record<string, unknown> = {
    app_id: env.appId,
    target_channel: 'push',
    headings: {en: params.payload.title || 'Hour'},
    contents: {en: params.payload.body || ''},
    data: {
      target: params.payload.target || 'home',
      category: params.payload.category || 'reminder',
      ...(targetUrl ? {targetUrl} : {}),
    },
    priority: 10,
    android_visibility: 1,
    ttl: 3600,
  };

  if (subIds.length) {
    body.include_subscription_ids = subIds;
  } else {
    body.include_aliases = {external_id: extIds};
  }

  if (params.sendAfterMs && params.sendAfterMs > Date.now() + 15_000) {
    body.send_after = new Date(params.sendAfterMs).toISOString();
  }

  const doPost = async (authScheme: 'Key' | 'Basic') => {
    const resp = await fetch('https://api.onesignal.com/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `${authScheme} ${env.restApiKey}`,
      },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // ignore parse failure
    }
    return {resp, json, text};
  };

  try {
    let attempt = await doPost('Key');
    if (attempt.resp.status === 401 || attempt.resp.status === 403) {
      attempt = await doPost('Basic');
    }
    if (!attempt.resp.ok) {
      const errs = Array.isArray(attempt.json.errors)
        ? attempt.json.errors.join('; ')
        : attempt.text.slice(0, 160);
      return {ok: false, error: errs || `OneSignal HTTP ${attempt.resp.status}`};
    }
    const id = typeof attempt.json.id === 'string' ? attempt.json.id : '';
    const recipients =
      typeof attempt.json.recipients === 'number' ? attempt.json.recipients : undefined;
    if (Array.isArray(attempt.json.errors) && attempt.json.errors.length && !id) {
      return {ok: false, error: attempt.json.errors.join('; ')};
    }
    return {ok: true, id, recipients};
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'OneSignal request failed',
    };
  }
}

export async function cancelOneSignalNotifications(ids: string[]): Promise<void> {
  const env = getOneSignalEnv();
  if (!env || !ids.length) return;
  await Promise.all(
    ids
      .filter((id) => typeof id === 'string' && id.trim().length > 0)
      .slice(0, 16)
      .map(async (id) => {
        try {
          await fetch(
            `https://api.onesignal.com/notifications/${encodeURIComponent(id.trim())}?app_id=${encodeURIComponent(env.appId)}`,
            {
              method: 'DELETE',
              headers: {Authorization: `Key ${env.restApiKey}`},
            },
          );
        } catch {
          // ignore cleanup failures
        }
      }),
  );
}

export async function scheduleOneSignalQueue(params: {
  subscriptionId?: string;
  externalId?: string;
  snapshot: StudySnapshot;
  config: NotifyConfig;
  lastCategory: NotifyCategory | null;
  origin?: string;
}): Promise<{scheduledIds: string[]; queue: PlannedSlot[]}> {
  const now = Date.now();
  const queue = generatePlannedQueue(
    params.snapshot,
    params.config,
    now,
    params.lastCategory,
    4,
  );
  if (!isOneSignalConfigured() || (!params.subscriptionId && !params.externalId)) {
    return {scheduledIds: [], queue};
  }

  const results = await Promise.all(
    queue.map(async (slot) => {
      const payload = buildRandomNotification(
        params.snapshot,
        params.config,
        slot.category,
        params.lastCategory,
        slot.fireAt,
      );
      payload.title = slot.previewTitle;
      payload.body = slot.previewBody;
      const res = await sendOneSignalPush({
        subscriptionIds: params.subscriptionId ? [params.subscriptionId] : undefined,
        externalIds: params.externalId ? [params.externalId] : undefined,
        payload,
        sendAfterMs: slot.fireAt,
        origin: params.origin,
      });
      return res.ok && res.id ? res.id : null;
    }),
  );

  return {
    scheduledIds: results.filter((id): id is string => Boolean(id)),
    queue,
  };
}

export async function sendWebPushWithKeys(
  subscription: PushSubscriptionData,
  payload: Record<string, unknown>,
  vapid: {publicKey: string; privateKey: string; subject: string},
): Promise<{ok: boolean; gone?: boolean; error?: string}> {
  try {
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
    await webpush.sendNotification(
      subscription as unknown as webpushNs.PushSubscription,
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
      return {ok: false, gone: true, error: 'subscription_expired'};
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'push_failed',
    };
  }
}
