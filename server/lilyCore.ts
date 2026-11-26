import {GoogleGenAI, ThinkingLevel, type Content} from '@google/genai';

export const LILY_MODEL = 'gemini-4-hydrogen';

export interface LilyChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export type LilyCoachMode = 'deep' | 'quick';

export interface SanitizedLilyRequest {
  messages: LilyChatMessage[];
  mode: LilyCoachMode;
  studyContextSummary: string;
}

export class LilyApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function isLilyConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
}

function createLilyAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : '';
  if (!apiKey) {
    throw new LilyApiError(
      503,
      'MISSING_API_KEY',
      'AI Coach Lily is not configured yet: GEMINI_API_KEY is missing on the server.',
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function cleanStr(val: unknown, maxLen = 200): string {
  if (typeof val !== 'string') return '';
  // Strip ASCII control chars except newline/tab
  const stripped = val.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  return stripped.trim().slice(0, maxLen);
}

function cleanNum(val: unknown, min = 0, max = 1_000_000): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return 0;
  return Math.max(min, Math.min(max, Math.round(n * 100) / 100));
}

function boundJsonValue(val: unknown, depth = 0): unknown {
  if (depth > 4) return null;
  if (val === null || val === undefined) return null;
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return Number.isFinite(val) ? Math.round(val * 100) / 100 : 0;
  if (typeof val === 'string') return cleanStr(val, 600);
  if (Array.isArray(val)) {
    return val.slice(0, 60).map((item) => boundJsonValue(item, depth + 1));
  }
  if (typeof val === 'object') {
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (count >= 45) break;
      const key = cleanStr(k, 64);
      if (!key) continue;
      out[key] = boundJsonValue(v, depth + 1);
      count++;
    }
    return out;
  }
  return null;
}

export function formatCoachContext(rawContext: unknown): string {
  if (!rawContext || typeof rawContext !== 'object' || Array.isArray(rawContext)) {
    return 'No live study telemetry was attached.';
  }

  const ctx = boundJsonValue(rawContext, 0) as Record<string, unknown>;
  const sections: string[] = [];

  const profile = (ctx.profile as Record<string, unknown>) || {};
  const today = (ctx.today as Record<string, unknown>) || {};
  const summary7d = (ctx.summary7d as Record<string, unknown>) || {};
  const summary30d = (ctx.summary30d as Record<string, unknown>) || {};
  const subjects = Array.isArray(ctx.subjects) ? (ctx.subjects as Array<Record<string, unknown>>) : [];
  const dailyTrend = Array.isArray(ctx.dailyTrend) ? (ctx.dailyTrend as Array<Record<string, unknown>>) : [];
  const recentEvents = Array.isArray(ctx.recentEvents) ? (ctx.recentEvents as Array<Record<string, unknown>>) : [];
  const chapterTimes = Array.isArray(ctx.chapterTimes) ? (ctx.chapterTimes as Array<Record<string, unknown>>) : [];
  const mocks = Array.isArray(ctx.mocks) ? (ctx.mocks as Array<Record<string, unknown>>) : [];
  const tests = Array.isArray(ctx.tests) ? (ctx.tests as Array<Record<string, unknown>>) : [];
  const upcomingTests = Array.isArray(ctx.upcomingTests) ? (ctx.upcomingTests as Array<Record<string, unknown>>) : [];
  const plannerToday = Array.isArray(ctx.plannerToday) ? (ctx.plannerToday as Array<Record<string, unknown>>) : [];
  const plannerSummary = (ctx.plannerSummary as Record<string, unknown>) || {};
  const focusSessions = Array.isArray(ctx.focusSessions) ? (ctx.focusSessions as Array<Record<string, unknown>>) : [];
  const books = Array.isArray(ctx.books) ? (ctx.books as Array<Record<string, unknown>>) : [];
  const diaryEntries = Array.isArray(ctx.diaryEntries) ? (ctx.diaryEntries as Array<Record<string, unknown>>) : [];

  const localDate = cleanStr(ctx.localDate, 32) || 'unknown';
  const localTime = cleanStr(ctx.localTime, 32) || '';

  sections.push(
    [
      '### 1. STUDENT PROFILE & GOALS',
      `- Local Date/Time: ${localDate}${localTime ? ' ' + localTime : ''}`,
      `- Name: ${cleanStr(profile.name, 40) || 'Student'}`,
      `- Target Exam: ${cleanStr(profile.exam, 80) || 'Not set'}`,
      profile.targetDate ? `- Exam Date: ${cleanStr(profile.targetDate, 24)} (${cleanNum(profile.daysToExam, -3650, 3650)} days remaining)` : '- Exam Date: Not set',
      `- Default Question Limit: ${cleanNum(profile.questionLimitSec, 5, 3600)}s | Daily Focus Goal: ${cleanNum(profile.dailyFocusGoalMin, 5, 720)} min`,
      `- Strict Blocker: ${profile.strictMode ? 'ON' : 'OFF'} | Blocked Apps: ${Array.isArray(profile.blockedApps) && profile.blockedApps.length ? profile.blockedApps.map((a) => cleanStr(a, 30)).join(', ') : 'None'}`,
      `- Arena Progress: ${cleanNum(profile.xp, 0, 10_000_000)} XP | Rank: ${cleanStr(profile.rank, 40) || 'Rookie'} | Streak: ${cleanNum(profile.streakDays, 0, 3650)} days | Duel W/L: ${cleanNum(profile.duelWins)}/${cleanNum(profile.duelLosses)}`,
    ].join('\n'),
  );

  sections.push(
    [
      '### 2. TODAY LIVE SNAPSHOT',
      `- Questions Attempted: ${cleanNum(today.attempted)} | Solved: ${cleanNum(today.solved)} | Left On Time (good): ${cleanNum(today.leftOnTime)} | Overtime / Late Skips (bad): ${cleanNum(today.overtimeSkips)} | Time-ups: ${cleanNum(today.timedOut)}`,
      `- Practice Time: ${cleanNum(today.practiceMin)} min | Avg Speed: ${cleanNum(today.avgSecPerQ)}s/Q | Tactical Leave Discipline: ${cleanNum(today.disciplinePct, 0, 100)}%`,
      `- Focus Minutes: ${cleanNum(today.focusMin)}m across ${cleanNum(today.focusSessions)} sessions | App Distractions (switches): ${cleanNum(today.distractions)} (${cleanNum(today.awaySec)}s away)`,
      `- Current Timer State: ${cleanStr(today.activeTimerState, 140) || 'Idle'}`,
    ].join('\n'),
  );

  sections.push(
    [
      '### 3. 7-DAY & 30-DAY SUMMARY',
      `- Last 7 Days: ${cleanNum(summary7d.attempted)} Q (${cleanNum(summary7d.solved)} solved, ${cleanNum(summary7d.leftOnTime)} left on time, ${cleanNum(summary7d.overtimeSkips)} overtime/skips, ${cleanNum(summary7d.timedOut)} timeouts) | ${cleanNum(summary7d.practiceMin)}m Q-practice | ${cleanNum(summary7d.focusMin)}m deep focus | ${cleanNum(summary7d.distractions)} distractions (${cleanNum(summary7d.awaySec)}s away) | Active days: ${cleanNum(summary7d.activeDays, 0, 7)}/7`,
      `- Last 30 Days: ${cleanNum(summary30d.attempted)} Q (${cleanNum(summary30d.solved)} solved, ${cleanNum(summary30d.leftOnTime)} left on time, ${cleanNum(summary30d.overtimeSkips)} overtime/skips) | ${cleanNum(summary30d.practiceMin)}m Q-practice | ${cleanNum(summary30d.focusMin)}m deep focus | ${cleanNum(summary30d.distractions)} distractions | Active days: ${cleanNum(summary30d.activeDays, 0, 31)}/30`,
    ].join('\n'),
  );

  if (subjects.length) {
    const rows = subjects.slice(0, 12).map((s) => {
      return `- ${cleanStr(s.name, 40) || cleanStr(s.code, 12)}: ${cleanNum(s.attempted)} Q | Solved ${cleanNum(s.solved)} (${cleanNum(s.solvePct, 0, 100)}%) | Left on time ${cleanNum(s.leftOnTime)} | Overtime/Skips ${cleanNum(s.overtimeSkips)} | Avg ${cleanNum(s.avgSec)}s vs target ${cleanNum(s.targetSec)}s`;
    });
    sections.push(['### 4. SUBJECT-WISE TELEMETRY', ...rows].join('\n'));
  }

  if (dailyTrend.length) {
    const rows = dailyTrend.slice(0, 14).map((d) => {
      return `- ${cleanStr(d.date, 16)}: ${cleanNum(d.q)} Q (S:${cleanNum(d.s)} L:${cleanNum(d.l)} Over/Skip:${cleanNum(d.k)} TO:${cleanNum(d.n)}), Q-min:${cleanNum(d.qMin)}m, Focus:${cleanNum(d.focusMin)}m, Distractions:${cleanNum(d.distractions)}`;
    });
    sections.push(['### 5. RECENT DAILY TREND (NEWEST FIRST)', ...rows].join('\n'));
  }

  if (recentEvents.length) {
    const rows = recentEvents.slice(0, 42).map((ev) => {
      const parts = [
        cleanStr(ev.at, 32),
        cleanStr(ev.kind, 24),
        cleanStr(ev.outcome || ev.title, 80),
        ev.subject ? `Subj:${cleanStr(ev.subject, 24)}` : '',
        ev.chapter ? `Ch:${cleanStr(ev.chapter, 40)}` : '',
        ev.sec ? `${cleanNum(ev.sec)}s` : '',
        ev.min ? `${cleanNum(ev.min)}m` : '',
        ev.note ? `(${cleanStr(ev.note, 60)})` : '',
      ].filter(Boolean);
      return `- ${parts.join(' · ')}`;
    });
    sections.push(['### 6. CHRONOLOGICAL SESSION & SKIP LOG (MOST RECENT FIRST)', ...rows].join('\n'));
  }

  if (chapterTimes.length) {
    const rows = chapterTimes.slice(0, 20).map((c) => {
      return `- ${cleanStr(c.subject, 24)} / ${cleanStr(c.chapter, 50)}: avg ${cleanNum(c.avgSec)}s/Q (${cleanNum(c.count)} samples, target cap ${cleanNum(c.capSec)}s)`;
    });
    sections.push(['### 7. CHAPTER-LEVEL PACING TELEMETRY', ...rows].join('\n'));
  }

  if (mocks.length || tests.length || upcomingTests.length) {
    const rows: string[] = [];
    mocks.slice(0, 10).forEach((m) => {
      rows.push(
        `- Mock (${cleanStr(m.date, 16)}) ${cleanStr(m.subject, 24)}: ${cleanNum(m.done)}/${cleanNum(m.totalQ)} done in ${cleanNum(m.usedMin)}/${cleanNum(m.limitMin)}m | Solved:${cleanNum(m.solved)} LeftOnTime:${cleanNum(m.leftOnTime)} Overtime:${cleanNum(m.overtime)}${m.chapters ? ' | Ch: ' + cleanStr(m.chapters, 70) : ''}`,
      );
    });
    tests.slice(0, 10).forEach((t) => {
      rows.push(
        `- Exam/Test (${cleanStr(t.date, 16)}) "${cleanStr(t.name, 50)}": ${cleanNum(t.score)}/${cleanNum(t.maxScore)} (${cleanNum(t.pct, 0, 100)}%)${t.breakdown ? ' | ' + cleanStr(t.breakdown, 80) : ''}`,
      );
    });
    upcomingTests.slice(0, 8).forEach((u) => {
      rows.push(
        `- UPCOMING Test (${cleanStr(u.date, 16)}, in ${cleanNum(u.daysLeft, -365, 3650)}d): "${cleanStr(u.name, 50)}"${u.chapters ? ' | Syllabus: ' + cleanStr(u.chapters, 90) : ''}`,
      );
    });
    sections.push(['### 8. MOCKS, TEST SCORES & UPCOMING EXAMS', ...rows].join('\n'));
  }

  if (plannerToday.length || plannerSummary.total7d) {
    const rows: string[] = [
      `- 7-Day Planner Completion: ${cleanNum(plannerSummary.done7d)}/${cleanNum(plannerSummary.total7d)} tasks (${cleanNum(plannerSummary.pct7d, 0, 100)}%)`,
    ];
    plannerToday.slice(0, 15).forEach((t) => {
      rows.push(
        `- [${t.done ? 'DONE' : 'TODO'}] ${cleanStr(t.title, 70)} (${cleanNum(t.plannedMin)}m${t.subject ? ', ' + cleanStr(t.subject, 16) : ''})`,
      );
    });
    sections.push(['### 9. DAILY PLANNER EXECUTION', ...rows].join('\n'));
  }

  if (focusSessions.length) {
    const rows = focusSessions.slice(0, 10).map((f) => `- ${cleanStr(f.at, 32)}: ${cleanNum(f.min)}m`);
    sections.push(['### 10. RECENT FOCUS SESSIONS', ...rows].join('\n'));
  }

  if (books.length) {
    const rows = books.slice(0, 8).map((b) => `- ${cleanStr(b.name, 50)}: ${cleanStr(b.progress, 60)}`);
    sections.push(['### 11. BOOKS PROGRESS', ...rows].join('\n'));
  }

  if (diaryEntries.length) {
    const rows = diaryEntries.slice(0, 5).map((d) => {
      return `- ${cleanStr(d.dateKey, 16)} [${cleanStr(d.mood, 20) || 'no mood'}]: ${d.title ? '"' + cleanStr(d.title, 60) + '" | ' : ''}${d.highlight ? 'Win: ' + cleanStr(d.highlight, 120) + ' | ' : ''}${d.tomorrowGoal ? 'Tomorrow goal: ' + cleanStr(d.tomorrowGoal, 120) + ' | ' : ''}Note: ${cleanStr(d.body, 280)}`;
    });
    sections.push(['### 12. RECENT DAILY DIARY REFLECTIONS', ...rows].join('\n'));
  }

  const joined = sections.join('\n\n');
  return joined.slice(0, 26_000);
}

export function sanitizeLilyRequest(body: Record<string, unknown>): SanitizedLilyRequest {
  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  const messages: LilyChatMessage[] = [];

  for (const item of rawMessages.slice(-24)) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const roleRaw = typeof rec.role === 'string' ? rec.role.trim().toLowerCase() : '';
    const role: 'user' | 'assistant' = roleRaw === 'assistant' || roleRaw === 'model' ? 'assistant' : 'user';
    const text = cleanStr(rec.text ?? rec.content, 4000);
    if (!text) continue;
    // Merge consecutive turns of the same role cleanly for Gemini contents ordering
    const prev = messages[messages.length - 1];
    if (prev && prev.role === role) {
      prev.text = `${prev.text}\n\n${text}`.slice(0, 6000);
    } else {
      messages.push({role, text});
    }
  }

  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    throw new LilyApiError(400, 'INVALID_MESSAGES', 'A user message is required.');
  }

  // Gemini multi-turn conversations should begin with a user turn
  while (messages.length > 0 && messages[0].role !== 'user') {
    messages.shift();
  }

  if (!messages.length) {
    throw new LilyApiError(400, 'INVALID_MESSAGES', 'Conversation must contain a user turn.');
  }

  const modeRaw = typeof body.mode === 'string' ? body.mode.trim().toLowerCase() : 'deep';
  const mode: LilyCoachMode = modeRaw === 'quick' ? 'quick' : 'deep';
  const studyContextSummary = formatCoachContext(body.studyContext);

  return {messages, mode, studyContextSummary};
}

function buildSystemInstruction(studyContextSummary: string, mode: LilyCoachMode): string {
  const depthInstruction =
    mode === 'quick'
      ? 'Keep this response tight, crisp, and high-signal (3 short bullets + 1 immediate action rule).'
      : 'Deliver deep, structured, diagnostic coaching worthy of an elite performance mentor. Use clear headings, exact metric callouts, root-cause reasoning, and concrete tactical fixes.';

  return [
    'You are Lily, the real-time personal AI Cognitive & Study Performance Coach inside the Hour app ("Leave It" — The Art of Moving On).',
    'You have direct live read access to this student’s complete study telemetry from their device and account.',
    '',
    'CORE DOMAIN KNOWLEDGE OF HOUR:',
    '- "Left on Time" (l) is POSITIVE tactical discipline: recognizing a stuck problem within the time budget and moving on instead of sinking into an ego trap.',
    '- "Overtime / Late Skips" (k) and "Time-ups" (n) represent losing control of the clock or refusing to leave before damage happens.',
    '- Strong exam performers balance high accuracy (Solved), ruthless Leave-on-Time discipline, sustained distraction-free Focus blocks, consistent Mock paper pacing, and Daily Planner follow-through.',
    '',
    'COACHING PRINCIPLES:',
    '1. ALWAYS cite concrete numbers, dates, subjects, chapters, mock scores, skips, focus minutes, distractions, or diary quotes from the live telemetry below whenever relevant. Never invent numbers.',
    '2. Diagnose root causes beneath surface metrics (e.g., clustered late skips after long streaks, high app-switch counts during late hours, huge gap between target question time and chapter average, skipped planner tasks before an upcoming test).',
    '3. If telemetry in a requested category is empty or zero, state clearly what data is missing and give a specific 10-minute starter protocol inside Hour to generate signal.',
    '4. End diagnostic replies with concrete, executable rules inside Hour (exact timer seconds, checkpoint duration, focus block duration, app-blocker strict mode choice, or next-day planner priorities).',
    '5. Tone: sharp, insightful, encouraging yet uncompromisingly honest — empathetic to tired/stressed diary entries while still protecting the student’s score.',
    depthInstruction,
    '',
    '=== LIVE STUDY TELEMETRY SNAPSHOT ===',
    studyContextSummary,
    '=== END TELEMETRY ===',
  ].join('\n');
}

function buildGeminiContents(messages: LilyChatMessage[]): Content[] {
  return messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{text: m.text}],
  }));
}

export async function generateLilyReply(reqData: SanitizedLilyRequest): Promise<string> {
  const ai = createLilyAiClient();
  const thinkingLevel = reqData.mode === 'quick' ? ThinkingLevel.LOW : ThinkingLevel.HIGH;
  const res = await ai.models.generateContent({
    model: LILY_MODEL,
    contents: buildGeminiContents(reqData.messages),
    config: {
      systemInstruction: buildSystemInstruction(reqData.studyContextSummary, reqData.mode),
      thinkingConfig: {thinkingLevel},
    },
  });
  return res.text || '';
}

export async function streamLilyReply(
  reqData: SanitizedLilyRequest,
  onChunk: (delta: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const ai = createLilyAiClient();
  const thinkingLevel = reqData.mode === 'quick' ? ThinkingLevel.LOW : ThinkingLevel.HIGH;
  const stream = await ai.models.generateContentStream({
    model: LILY_MODEL,
    contents: buildGeminiContents(reqData.messages),
    config: {
      systemInstruction: buildSystemInstruction(reqData.studyContextSummary, reqData.mode),
      thinkingConfig: {thinkingLevel},
    },
  });

  let fullText = '';
  for await (const chunk of stream) {
    if (signal?.aborted) break;
    const text = typeof chunk.text === 'string' ? chunk.text : '';
    if (text) {
      fullText += text;
      onChunk(text);
    }
  }
  return fullText;
}

export function formatGeminiHttpError(err: unknown): {status: number; code: string; message: string} {
  if (err instanceof LilyApiError) {
    return {status: err.status, code: err.code, message: err.message};
  }
  const msg = err instanceof Error ? err.message : 'Unable to reach Gemini right now.';
  const lower = msg.toLowerCase();
  if (lower.includes('api key') || lower.includes('permission') || lower.includes('unauthenticated')) {
    return {status: 403, code: 'GEMINI_AUTH_ERROR', message: msg};
  }
  if (lower.includes('quota') || lower.includes('rate limit') || lower.includes('429')) {
    return {status: 429, code: 'GEMINI_RATE_LIMIT', message: msg};
  }
  return {status: 502, code: 'GEMINI_UPSTREAM_ERROR', message: msg};
}
