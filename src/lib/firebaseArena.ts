import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  auth,
  clearArenaLogs,
  db,
  firebaseConfig,
  getArenaLogs,
  googleProvider,
  handleFirestoreError,
  isSignInWithEmailLink,
  onAuthStateChanged,
  OperationType,
  recordArenaLog,
  reportFirestoreListenerError,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signInWithPopup,
  signOut,
  subscribeArenaLogs,
  type User,
} from '../firebase';

export type ActivityKind =
  | 'focus_session'
  | 'question_solved'
  | 'question_left_on_time'
  | 'question_overtime'
  | 'mock_test'
  | 'task_completed';

export type RoomMode = 'study_room' | 'sprint_1v1';
export type RoomStatus = 'lobby' | 'countdown' | 'active' | 'finished';
export type LiveState = 'idle' | 'focusing' | 'solving' | 'paused' | 'finished';
export type LeaderboardSort = 'xp' | 'focus' | 'questions' | 'duels';
export type LeaderboardTimeframe = 'today' | '7d' | 'all';
export type FriendshipStatus = 'pending' | 'accepted';
export type FriendDirection = 'incoming' | 'outgoing' | 'friend';
export type RoomMessageKind = 'chat' | 'rivalry' | 'cheer';

export interface FriendEntry {
  pairId: string;
  uid: string;
  username: string;
  displayName: string;
  status: FriendshipStatus;
  direction: FriendDirection;
  createdAtMs: number;
}

export interface FriendInviteView {
  id: string;
  fromUid: string;
  fromUsername: string;
  fromDisplayName: string;
  toUid: string;
  roomCode: string;
  roomTitle: string;
  roomMode: RoomMode;
  roomSubject: string;
  createdAtMs: number;
}

export interface RoomMessageView {
  id: string;
  roomCode: string;
  senderUid: string;
  senderUsername: string;
  senderDisplayName: string;
  kind: RoomMessageKind;
  text: string;
  createdAtMs: number;
}

export interface ArenaUser {
  id: string;
  username: string;
  displayName: string;
  xp: number;
  focusMinutes: number;
  streakDays: number;
  lastActiveDate: string | null;
  questionsSolved: number;
  questionsLeftOnTime: number;
  questionsOvertime: number;
  mockTestsCount: number;
  mockAccuracyAvg: number;
  duelWins: number;
  duelPlayed: number;
  solveRatePct: number;
  disciplineRatePct: number;
  todayKey: string;
  todayXp: number;
  todayFocusMinutes: number;
  todayQuestionsSolved: number;
  weekKey: string;
  weekXp: number;
  weekFocusMinutes: number;
  weekQuestionsSolved: number;
  tasksCompleted: number;
  todayTasksCompleted: number;
  weekTasksCompleted: number;
}

export interface RoomParticipantView {
  userId: string;
  username: string;
  displayName: string;
  streakDays: number;
  isHost: boolean;
  ready: boolean;
  liveState: LiveState;
  solvedCount: number;
  leftOnTimeCount: number;
  overtimeCount: number;
  focusSeconds: number;
  sprintScore: number;
  tasksCompleted: number;
  activeTaskTitle: string;
}

export interface RoomSnapshot {
  roomCode: string;
  mode: RoomMode;
  title: string;
  subject: string;
  durationSec: number;
  questionLimitSec: number;
  status: RoomStatus;
  hostUserId: string;
  hostDisplayName: string;
  maxPlayers: number;
  isPublic: boolean;
  countdownEndsAt: number | null;
  startedAt: number | null;
  endsAt: number | null;
  winnerUserId: string | null;
  winnerDisplayName: string | null;
  participants: RoomParticipantView[];
}

export interface PublicRoomSummary {
  roomCode: string;
  mode: RoomMode;
  title: string;
  subject: string;
  durationSec: number;
  questionLimitSec: number;
  status: RoomStatus;
  hostDisplayName: string;
  maxPlayers: number;
  participantCount: number;
}

export interface LeaderboardEntry {
  rank: number;
  id: string;
  username: string;
  displayName: string;
  xp: number;
  focusMinutes: number;
  streakDays: number;
  questionsSolved: number;
  questionsLeftOnTime: number;
  questionsOvertime: number;
  solveRatePct: number;
  disciplineRatePct: number;
  mockTestsCount: number;
  mockAccuracyAvg: number;
  duelWins: number;
  duelPlayed: number;
  tasksCompleted: number;
}

function todayStr(offsetDays = 0): string {
  const d = new Date(Date.now() - offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

function weekStartStr(): string {
  const d = new Date();
  const day = d.getUTCDay();
  const diff = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

function sanitizeUsername(raw: string, fallbackSuffix: string): string {
  const safeSuffix = fallbackSuffix.toLowerCase().replace(/[^a-z0-9_.]/g, '0') || '001';
  let clean = raw
    .toLowerCase()
    .replace(/[^a-z0-9_.]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20);
  if (clean.length < 3) {
    clean = ('player_' + safeSuffix).slice(0, 20);
  }
  return clean;
}

function sanitizeDisplayName(raw: string): string {
  const clean = raw.trim().replace(/\s+/g, ' ').slice(0, 24);
  return clean.length >= 2 ? clean : 'Focus Player';
}

function sanitizeId(raw: string): string {
  const clean = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  return clean.length >= 4 ? clean : 'act_' + Date.now();
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 6; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

function computeSprintScore(p: {
  solvedCount: number;
  leftOnTimeCount: number;
  overtimeCount: number;
  focusSeconds: number;
  tasksCompleted?: number;
}): number {
  return (
    p.solvedCount * 25 +
    p.leftOnTimeCount * 15 +
    p.overtimeCount * 5 +
    Math.floor(p.focusSeconds / 60) * 4 +
    (p.tasksCompleted || 0) * 30
  );
}

function toArenaUser(d: Record<string, unknown>): ArenaUser {
  const solved = Number(d.questionsSolved || 0);
  const left = Number(d.questionsLeftOnTime || 0);
  const over = Number(d.questionsOvertime || 0);
  const totalQ = solved + left + over;
  const totalLeft = left + over;
  const mocks = Number(d.mockTestsCount || 0);
  const mockSum = Number(d.mockAccuracySum || 0);
  const tKey = todayStr(0);
  const wKey = weekStartStr();
  return {
    id: String(d.uid || ''),
    username: String(d.username || 'player'),
    displayName: String(d.displayName || 'Focus Player'),
    xp: Number(d.xp || 0),
    focusMinutes: Number(d.focusMinutes || 0),
    streakDays: Number(d.streakDays || 0),
    lastActiveDate: d.lastActiveDate ? String(d.lastActiveDate) : null,
    questionsSolved: solved,
    questionsLeftOnTime: left,
    questionsOvertime: over,
    mockTestsCount: mocks,
    mockAccuracyAvg: mocks > 0 ? Math.round((mockSum / mocks) * 10) / 10 : 0,
    duelWins: Number(d.duelWins || 0),
    duelPlayed: Number(d.duelPlayed || 0),
    solveRatePct: totalQ > 0 ? Math.round((solved / totalQ) * 100) : 0,
    disciplineRatePct: totalLeft > 0 ? Math.round((left / totalLeft) * 100) : 100,
    todayKey: String(d.todayKey || ''),
    todayXp: d.todayKey === tKey ? Number(d.todayXp || 0) : 0,
    todayFocusMinutes: d.todayKey === tKey ? Number(d.todayFocusMinutes || 0) : 0,
    todayQuestionsSolved:
      d.todayKey === tKey ? Number(d.todayQuestionsSolved || 0) : 0,
    weekKey: String(d.weekKey || ''),
    weekXp: d.weekKey === wKey ? Number(d.weekXp || 0) : 0,
    weekFocusMinutes: d.weekKey === wKey ? Number(d.weekFocusMinutes || 0) : 0,
    weekQuestionsSolved:
      d.weekKey === wKey ? Number(d.weekQuestionsSolved || 0) : 0,
    tasksCompleted: Number(d.tasksCompleted || 0),
    todayTasksCompleted: d.todayKey === tKey ? Number(d.todayTasksCompleted || 0) : 0,
    weekTasksCompleted: d.weekKey === wKey ? Number(d.weekTasksCompleted || 0) : 0,
  };
}

async function ensurePlayerProfile(fbUser: User): Promise<ArenaUser> {
  if (!fbUser.emailVerified) {
    const msg = 'Email verification is required before using Arena.';
    recordArenaLog({
      level: 'warn',
      source: 'auth',
      message: msg,
      detail: `uid=${fbUser.uid}`,
    });
    throw new Error(msg);
  }
  const path = `players/${fbUser.uid}`;
  const playerRef = doc(db, 'players', fbUser.uid);
  try {
    const snap = await getDoc(playerRef);
    if (snap.exists()) {
      return toArenaUser(snap.data() as Record<string, unknown>);
    }

    const emailPrefix = (fbUser.email || '').split('@')[0] || '';
    const baseName = sanitizeUsername(
      emailPrefix || fbUser.displayName || 'player',
      fbUser.uid.slice(0, 6).toLowerCase(),
    );
    const displayName = sanitizeDisplayName(
      fbUser.displayName || baseName || 'Focus Player',
    );
    const tKey = todayStr(0);
    const wKey = weekStartStr();

    const created = await runTransaction(db, async (tx) => {
      const check = await tx.get(playerRef);
      if (check.exists()) {
        return check.data() as Record<string, unknown>;
      }
      const payload = {
        uid: fbUser.uid,
        username: baseName,
        displayName,
        xp: 0,
        focusMinutes: 0,
        streakDays: 0,
        lastActiveDate: '',
        questionsSolved: 0,
        questionsLeftOnTime: 0,
        questionsOvertime: 0,
        mockTestsCount: 0,
        mockAccuracySum: 0,
        duelWins: 0,
        duelPlayed: 0,
        todayKey: tKey,
        todayXp: 0,
        todayFocusMinutes: 0,
        todayQuestionsSolved: 0,
        weekKey: wKey,
        weekXp: 0,
        weekFocusMinutes: 0,
        weekQuestionsSolved: 0,
        tasksCompleted: 0,
        todayTasksCompleted: 0,
        weekTasksCompleted: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      tx.set(playerRef, payload);
      return payload;
    });

    const freshSnap = await getDoc(playerRef);
    return toArenaUser(
      (freshSnap.exists() ? freshSnap.data() : created) as Record<
        string,
        unknown
      >,
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

const EMAIL_LINK_KEY = 'leaveit_email_link';

export async function sendEmailSignInLink(rawEmail: string): Promise<void> {
  const email = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Enter a valid email address.');
  }
  const actionCodeSettings = {
    url: window.location.origin + window.location.pathname,
    handleCodeInApp: true,
  };
  try {
    await sendSignInLinkToEmail(auth, email, actionCodeSettings);
    try {
      window.localStorage.setItem(EMAIL_LINK_KEY, email);
    } catch {
      // Ignore storage error
    }
  } catch (err) {
    const code = (err as {code?: string})?.code || '';
    if (
      code === 'auth/operation-not-allowed' ||
      code === 'auth/admin-restricted-operation'
    ) {
      throw new Error(
        'Passwordless Email Link is not enabled in Firebase Console yet. Enable Email/Password → "Email link (passwordless sign-in)" in Firebase Console, or sign in instantly with Google.',
      );
    }
    if (err instanceof Error) throw err;
    throw new Error('Could not send sign-in email. Please try again.');
  }
}

export function isPendingEmailLinkSignIn(): boolean {
  try {
    return isSignInWithEmailLink(auth, window.location.href);
  } catch {
    return false;
  }
}

let emailLinkInFlight: Promise<{
  completed: boolean;
  needsEmail?: boolean;
  user?: ArenaUser;
}> | null = null;

export async function completeEmailLinkIfPresent(
  suppliedEmail?: string,
): Promise<{completed: boolean; needsEmail?: boolean; user?: ArenaUser}> {
  if (!isPendingEmailLinkSignIn()) {
    return {completed: false};
  }
  let storedEmail = '';
  try {
    storedEmail = window.localStorage.getItem(EMAIL_LINK_KEY) || '';
  } catch {
    storedEmail = '';
  }
  const email = (suppliedEmail || storedEmail).trim().toLowerCase();
  if (!email) {
    return {completed: false, needsEmail: true};
  }

  if (emailLinkInFlight) {
    return emailLinkInFlight;
  }

  emailLinkInFlight = (async () => {
    try {
      const cred = await signInWithEmailLink(auth, email, window.location.href);
      try {
        window.localStorage.removeItem(EMAIL_LINK_KEY);
        window.history.replaceState({}, document.title, window.location.pathname);
      } catch {
        // Ignore history/storage errors
      }
      const profile = await ensurePlayerProfile(cred.user);
      return {completed: true, user: profile};
    } catch (err) {
      if (err instanceof Error) throw err;
      throw new Error(
        'Could not verify email sign-in link. Please request a new link.',
      );
    } finally {
      emailLinkInFlight = null;
    }
  })();

  return emailLinkInFlight;
}

export async function signInArenaWithGoogle(): Promise<ArenaUser> {
  try {
    const cred = await signInWithPopup(auth, googleProvider);
    return await ensurePlayerProfile(cred.user);
  } catch (err) {
    const code = (err as {code?: string})?.code || '';
    if (code === 'auth/popup-blocked') {
      throw new Error('Popup was blocked. Please allow popups for this site and try again.');
    }
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      throw new Error('Sign-in popup was closed before completing.');
    }
    if (err instanceof Error) throw err;
    throw new Error('Google sign-in failed. Please try again.');
  }
}

export async function signOutArena(): Promise<void> {
  await signOut(auth);
}

export function subscribeArenaAuth(
  cb: (user: ArenaUser | null) => void,
): Unsubscribe {
  return onAuthStateChanged(auth, async (fbUser) => {
    if (!fbUser) {
      cb(null);
      return;
    }
    try {
      const profile = await ensurePlayerProfile(fbUser);
      cb(profile);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Failed to load Arena profile:', err);
      recordArenaLog({
        level: 'error',
        source: 'auth-profile',
        message: msg,
        path: `players/${fbUser.uid}`,
      });
      cb(null);
    }
  });
}

export async function updateArenaProfile(params: {
  username: string;
  displayName: string;
}): Promise<ArenaUser> {
  const fbUser = auth.currentUser;
  if (!fbUser) throw new Error('Sign in required.');
  const cleanUser = params.username.trim().toLowerCase();
  if (!/^[a-z0-9_.]{3,20}$/.test(cleanUser)) {
    throw new Error(
      'Username must be 3–20 lowercase letters, numbers, underscores, or dots.',
    );
  }
  const cleanDisp = params.displayName.trim().replace(/\s+/g, ' ');
  if (cleanDisp.length < 2 || cleanDisp.length > 24) {
    throw new Error('Display name must be 2–24 characters.');
  }
  const path = `players/${fbUser.uid}`;
  const ref = doc(db, 'players', fbUser.uid);
  try {
    await updateDoc(ref, {
      username: cleanUser,
      displayName: cleanDisp,
      updatedAt: serverTimestamp(),
    });
    const fresh = await getDoc(ref);
    return toArenaUser(fresh.data() as Record<string, unknown>);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function recordArenaActivity(payload: {
  clientSessionId: string;
  kind: ActivityKind;
  roomCode?: string;
  subject?: string;
  focusMinutes?: number;
  elapsedSec?: number;
  mockAccuracy?: number;
  plannedMinutes?: number;
  fromFocus?: boolean;
  taskTitle?: string;
}): Promise<{duplicate: boolean; user: ArenaUser; xpDelta: number}> {
  const fbUser = auth.currentUser;
  if (!fbUser) throw new Error('Sign in required.');

  const uid = fbUser.uid;
  const actId = sanitizeId(payload.clientSessionId);
  const playerRef = doc(db, 'players', uid);
  const actRef = doc(db, 'players', uid, 'activities', actId);
  const cleanRoomCode = (payload.roomCode || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
  const hasRoom = cleanRoomCode.length === 6;
  const roomRef = hasRoom ? doc(db, 'rooms', cleanRoomCode) : null;
  const partRef = hasRoom
    ? doc(db, 'rooms', cleanRoomCode, 'participants', uid)
    : null;

  let baseXpDelta = 0;
  let focusDelta = 0;
  let solvedDelta = 0;
  let leftDelta = 0;
  let overDelta = 0;
  let mockDelta = 0;
  let mockAccSumDelta = 0;
  let mockAccVal = 0;
  let tasksDelta = 0;

  switch (payload.kind) {
    case 'focus_session': {
      const mins = Math.max(
        1,
        Math.min(240, Math.round(Number(payload.focusMinutes) || 0)),
      );
      focusDelta = mins;
      baseXpDelta = mins * 2;
      break;
    }
    case 'question_solved':
      solvedDelta = 1;
      baseXpDelta = 15;
      break;
    case 'question_left_on_time':
      leftDelta = 1;
      baseXpDelta = 10;
      break;
    case 'question_overtime':
      overDelta = 1;
      baseXpDelta = 4;
      break;
    case 'mock_test': {
      const acc = Math.max(0, Math.min(100, Number(payload.mockAccuracy) || 0));
      mockDelta = 1;
      mockAccSumDelta = acc;
      mockAccVal = acc;
      baseXpDelta = 30 + Math.round(acc * 0.4);
      break;
    }
    case 'task_completed': {
      const plannedMin = Math.max(
        0,
        Math.min(240, Math.round(Number(payload.plannedMinutes) || 0)),
      );
      const durBonus = Math.min(20, Math.floor(plannedMin / 10) * 3);
      const focusBonus = payload.fromFocus ? 10 : 0;
      tasksDelta = 1;
      baseXpDelta = 15 + durBonus + focusBonus;
      break;
    }
  }

  try {
    const out = await runTransaction(db, async (tx) => {
      const actSnap = await tx.get(actRef);
      const playerSnap = await tx.get(playerRef);
      if (!playerSnap.exists()) {
        throw new Error('Player profile not initialized.');
      }
      const pData = playerSnap.data() as Record<string, unknown>;
      if (actSnap.exists()) {
        return {duplicate: true, user: toArenaUser(pData), xpDelta: 0};
      }

      let roomActive = false;
      let partData: Record<string, unknown> | null = null;
      if (roomRef && partRef) {
        const roomSnap = await tx.get(roomRef);
        const partSnap = await tx.get(partRef);
        const rData = roomSnap.exists() ? (roomSnap.data() as Record<string, unknown>) : null;
        const pIds = rData && Array.isArray(rData.participantIds) ? (rData.participantIds as string[]) : [];
        if (
          rData &&
          partSnap.exists() &&
          (rData.status === 'active' || (payload.kind === 'task_completed' && rData.status === 'lobby')) &&
          pIds.includes(uid)
        ) {
          roomActive = true;
          partData = partSnap.data() as Record<string, unknown>;
        }
      }

      const xpDelta = Math.min(
        500,
        baseXpDelta + (payload.kind === 'task_completed' && roomActive ? 10 : 0),
      );

      const tKey = todayStr(0);
      const yesterday = todayStr(1);
      const wKey = weekStartStr();

      const prevLast = String(pData.lastActiveDate || '');
      let nextStreak = Number(pData.streakDays || 0);
      if (prevLast !== tKey) {
        nextStreak = prevLast === yesterday ? nextStreak + 1 : 1;
      }

      const prevTodayXp = pData.todayKey === tKey ? Number(pData.todayXp || 0) : 0;
      const prevTodayFocus =
        pData.todayKey === tKey ? Number(pData.todayFocusMinutes || 0) : 0;
      const prevTodaySolved =
        pData.todayKey === tKey ? Number(pData.todayQuestionsSolved || 0) : 0;
      const prevTodayTasks =
        pData.todayKey === tKey ? Number(pData.todayTasksCompleted || 0) : 0;

      const prevWeekXp = pData.weekKey === wKey ? Number(pData.weekXp || 0) : 0;
      const prevWeekFocus =
        pData.weekKey === wKey ? Number(pData.weekFocusMinutes || 0) : 0;
      const prevWeekSolved =
        pData.weekKey === wKey ? Number(pData.weekQuestionsSolved || 0) : 0;
      const prevWeekTasks =
        pData.weekKey === wKey ? Number(pData.weekTasksCompleted || 0) : 0;

      const nextPlayerFields = {
        xp: Number(pData.xp || 0) + xpDelta,
        focusMinutes: Number(pData.focusMinutes || 0) + focusDelta,
        streakDays: nextStreak,
        lastActiveDate: tKey,
        questionsSolved: Number(pData.questionsSolved || 0) + solvedDelta,
        questionsLeftOnTime: Number(pData.questionsLeftOnTime || 0) + leftDelta,
        questionsOvertime: Number(pData.questionsOvertime || 0) + overDelta,
        mockTestsCount: Number(pData.mockTestsCount || 0) + mockDelta,
        mockAccuracySum: Number(pData.mockAccuracySum || 0) + mockAccSumDelta,
        duelWins: Number(pData.duelWins || 0),
        duelPlayed: Number(pData.duelPlayed || 0),
        todayKey: tKey,
        todayXp: prevTodayXp + xpDelta,
        todayFocusMinutes: prevTodayFocus + focusDelta,
        todayQuestionsSolved: prevTodaySolved + solvedDelta,
        weekKey: wKey,
        weekXp: prevWeekXp + xpDelta,
        weekFocusMinutes: prevWeekFocus + focusDelta,
        weekQuestionsSolved: prevWeekSolved + solvedDelta,
        tasksCompleted: Number(pData.tasksCompleted || 0) + tasksDelta,
        todayTasksCompleted: prevTodayTasks + tasksDelta,
        weekTasksCompleted: prevWeekTasks + tasksDelta,
        updatedAt: serverTimestamp(),
      };

      tx.set(actRef, {
        uid,
        clientSessionId: actId,
        kind: payload.kind,
        roomCode: hasRoom ? cleanRoomCode : '',
        subject: (payload.subject || 'General').trim().slice(0, 32),
        xpDelta,
        focusMinutesDelta: focusDelta,
        solvedDelta,
        leftOnTimeDelta: leftDelta,
        overtimeDelta: overDelta,
        mockAccuracy: mockAccVal,
        createdAt: serverTimestamp(),
      });

      tx.update(playerRef, nextPlayerFields);

      if (roomActive && partRef && partData) {
        const nextSolved = Number(partData.solvedCount || 0) + solvedDelta;
        const nextLeft = Number(partData.leftOnTimeCount || 0) + leftDelta;
        const nextOver = Number(partData.overtimeCount || 0) + overDelta;
        const nextTasks = Math.min(1000, Number(partData.tasksCompleted || 0) + tasksDelta);
        const nextFocusSec = Math.min(
          14400,
          Number(partData.focusSeconds || 0) + focusDelta * 60,
        );
        const nextScore = computeSprintScore({
          solvedCount: nextSolved,
          leftOnTimeCount: nextLeft,
          overtimeCount: nextOver,
          focusSeconds: nextFocusSec,
          tasksCompleted: nextTasks,
        });
        tx.update(partRef, {
          solvedCount: nextSolved,
          leftOnTimeCount: nextLeft,
          overtimeCount: nextOver,
          tasksCompleted: nextTasks,
          focusSeconds: nextFocusSec,
          sprintScore: nextScore,
          updatedAt: serverTimestamp(),
        });
      }

      return {
        duplicate: false,
        user: toArenaUser({...pData, ...nextPlayerFields}),
        xpDelta,
      };
    });

    return out;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `players/${uid}/activities/${actId}`);
  }
}

export async function createArenaRoom(input: {
  mode: RoomMode;
  title?: string;
  subject?: string;
  durationMin?: number;
  questionLimitSec?: number;
  isPublic?: boolean;
}): Promise<RoomSnapshot> {
  const fbUser = auth.currentUser;
  if (!fbUser) throw new Error('Sign in required.');
  const uid = fbUser.uid;
  const mode: RoomMode = input.mode === 'sprint_1v1' ? 'sprint_1v1' : 'study_room';
  const maxPlayers = mode === 'sprint_1v1' ? 2 : 12;
  const durationSec =
    Math.max(5, Math.min(180, Math.round(Number(input.durationMin) || 25))) * 60;
  const questionLimitSec = Math.max(
    15,
    Math.min(600, Math.round(Number(input.questionLimitSec) || 90)),
  );
  const subject = (input.subject || 'General').trim().slice(0, 24) || 'General';
  const defaultTitle =
    mode === 'sprint_1v1' ? `${subject} 1v1 Sprint` : `${subject} Study Room`;
  const rawTitle = (input.title || '').trim().slice(0, 48);
  const title = (rawTitle.length >= 2 ? rawTitle : defaultTitle).slice(0, 48);
  const isPublic = input.isPublic !== false;

  const playerRef = doc(db, 'players', uid);

  for (let attempt = 0; attempt < 6; attempt++) {
    const code = generateRoomCode();
    const roomRef = doc(db, 'rooms', code);
    const partRef = doc(db, 'rooms', code, 'participants', uid);

    try {
      const result = await runTransaction(db, async (tx) => {
        const roomSnap = await tx.get(roomRef);
        if (roomSnap.exists()) return null;
        const playerSnap = await tx.get(playerRef);
        if (!playerSnap.exists()) {
          throw new Error('Player profile not found.');
        }
        const p = toArenaUser(playerSnap.data() as Record<string, unknown>);

        tx.set(roomRef, {
          roomCode: code,
          mode,
          title,
          subject,
          durationSec,
          questionLimitSec,
          status: 'lobby',
          hostUserId: uid,
          hostDisplayName: p.displayName,
          maxPlayers,
          isPublic,
          participantIds: [uid],
          participantCount: 1,
          countdownEndsAtMs: 0,
          startedAtMs: 0,
          endsAtMs: 0,
          winnerUserId: '',
          winnerDisplayName: '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        tx.set(partRef, {
          uid,
          roomCode: code,
          username: p.username,
          displayName: p.displayName,
          streakDays: p.streakDays,
          isHost: true,
          ready: false,
          roomIsPublic: isPublic,
          allowedUids: [uid],
          liveState: 'idle',
          solvedCount: 0,
          leftOnTimeCount: 0,
          overtimeCount: 0,
          focusSeconds: 0,
          sprintScore: 0,
          tasksCompleted: 0,
          activeTaskTitle: '',
          joinedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        return {
          roomCode: code,
          mode,
          title,
          subject,
          durationSec,
          questionLimitSec,
          status: 'lobby' as RoomStatus,
          hostUserId: uid,
          hostDisplayName: p.displayName,
          maxPlayers,
          isPublic,
          countdownEndsAt: null,
          startedAt: null,
          endsAt: null,
          winnerUserId: null,
          winnerDisplayName: null,
          participants: [
            {
              userId: uid,
              username: p.username,
              displayName: p.displayName,
              streakDays: p.streakDays,
              isHost: true,
              ready: false,
              liveState: 'idle' as LiveState,
              solvedCount: 0,
              leftOnTimeCount: 0,
              overtimeCount: 0,
              focusSeconds: 0,
              sprintScore: 0,
              tasksCompleted: 0,
              activeTaskTitle: '',
            },
          ],
        };
      });

      if (result) return result;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `rooms/${code}`);
    }
  }
  throw new Error('Could not generate a unique room code. Please try again.');
}

export async function joinArenaRoom(rawCode: string): Promise<RoomSnapshot> {
  const fbUser = auth.currentUser;
  if (!fbUser) throw new Error('Sign in required.');
  const uid = fbUser.uid;
  const code = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    throw new Error('Enter a valid 6-character room code.');
  }

  const roomRef = doc(db, 'rooms', code);
  const partRef = doc(db, 'rooms', code, 'participants', uid);
  const playerRef = doc(db, 'players', uid);

  try {
    await runTransaction(db, async (tx) => {
      const roomSnap = await tx.get(roomRef);
      if (!roomSnap.exists()) {
        throw new Error('Room not found. Double-check the 6-character code.');
      }
      const r = roomSnap.data() as Record<string, unknown>;
      const existingIds = Array.isArray(r.participantIds)
        ? (r.participantIds as string[])
        : [];
      if (existingIds.includes(uid)) {
        return;
      }
      if (r.status !== 'lobby') {
        throw new Error('This match has already started or finished.');
      }
      if (existingIds.length >= Number(r.maxPlayers || 2)) {
        throw new Error('This room is already full.');
      }

      const playerSnap = await tx.get(playerRef);
      if (!playerSnap.exists()) {
        throw new Error('Player profile not found.');
      }
      const p = toArenaUser(playerSnap.data() as Record<string, unknown>);
      const nextIds = [...existingIds, uid];

      tx.update(roomRef, {
        participantIds: nextIds,
        participantCount: nextIds.length,
        updatedAt: serverTimestamp(),
      });

      tx.set(partRef, {
        uid,
        roomCode: code,
        username: p.username,
        displayName: p.displayName,
        streakDays: p.streakDays,
        isHost: false,
        ready: false,
        roomIsPublic: Boolean(r.isPublic),
        allowedUids: nextIds,
        liveState: 'idle',
        solvedCount: 0,
        leftOnTimeCount: 0,
        overtimeCount: 0,
        focusSeconds: 0,
        sprintScore: 0,
        tasksCompleted: 0,
        activeTaskTitle: '',
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    const snap = await fetchRoomSnapshot(code);
    if (!snap) throw new Error('Room not found.');
    return snap;
  } catch (error) {
    if (error instanceof Error && !error.message.toLowerCase().includes('permission')) {
      recordArenaLog({
        level: 'error',
        source: 'joinRoom',
        message: error.message,
        operationType: OperationType.WRITE,
        path: `rooms/${code}`,
      });
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, `rooms/${code}`);
  }
}

export async function leaveArenaRoom(rawCode: string): Promise<void> {
  const fbUser = auth.currentUser;
  if (!fbUser) return;
  const uid = fbUser.uid;
  const code = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z0-9]{6}$/.test(code)) return;

  const roomRef = doc(db, 'rooms', code);
  const partRef = doc(db, 'rooms', code, 'participants', uid);

  try {
    await runTransaction(db, async (tx) => {
      const roomSnap = await tx.get(roomRef);
      if (!roomSnap.exists()) return;
      const r = roomSnap.data() as Record<string, unknown>;
      const existingIds = Array.isArray(r.participantIds)
        ? (r.participantIds as string[])
        : [];
      if (!existingIds.includes(uid)) return;

      if (r.status === 'finished') {
        tx.delete(partRef);
        return;
      }

      if (existingIds.length <= 1) {
        tx.update(roomRef, {
          status: 'finished',
          updatedAt: serverTimestamp(),
        });
        tx.delete(partRef);
      } else {
        const nextIds = existingIds.filter((id) => id !== uid);
        tx.update(roomRef, {
          participantIds: nextIds,
          participantCount: nextIds.length,
          updatedAt: serverTimestamp(),
        });
        tx.delete(partRef);
      }
    });
    void purgeRoomMessages(code);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${code}`);
  }
}

export async function setArenaReady(rawCode: string, ready: boolean): Promise<void> {
  const fbUser = auth.currentUser;
  if (!fbUser) throw new Error('Sign in required.');
  const code = rawCode.trim().toUpperCase();
  const partRef = doc(db, 'rooms', code, 'participants', fbUser.uid);
  try {
    await updateDoc(partRef, {
      ready: Boolean(ready),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.UPDATE,
      `rooms/${code}/participants/${fbUser.uid}`,
    );
  }
}

export async function startArenaRoom(rawCode: string): Promise<void> {
  const fbUser = auth.currentUser;
  if (!fbUser) throw new Error('Sign in required.');
  const code = rawCode.trim().toUpperCase();
  const roomRef = doc(db, 'rooms', code);

  try {
    await runTransaction(db, async (tx) => {
      const roomSnap = await tx.get(roomRef);
      if (!roomSnap.exists()) throw new Error('Room not found.');
      const r = roomSnap.data() as Record<string, unknown>;
      if (r.hostUserId !== fbUser.uid) {
        throw new Error('Only the room host can start the match.');
      }
      if (r.status !== 'lobby') {
        throw new Error('Match already started.');
      }
      const pCount = Number(r.participantCount || 0);
      if (r.mode === 'sprint_1v1' && pCount < 2) {
        throw new Error('A 1v1 Sprint needs 2 players before starting.');
      }

      const now = Date.now();
      const countdownEndsAtMs = now + 5000;
      const startedAtMs = countdownEndsAtMs;
      const endsAtMs = startedAtMs + Number(r.durationSec || 1500) * 1000;

      tx.update(roomRef, {
        status: 'countdown',
        countdownEndsAtMs,
        startedAtMs,
        endsAtMs,
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    if (error instanceof Error && !error.message.includes('permission')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${code}`);
  }
}

export async function activateArenaRoomIfDue(rawCode: string): Promise<void> {
  const fbUser = auth.currentUser;
  if (!fbUser) return;
  const code = rawCode.trim().toUpperCase();
  const roomRef = doc(db, 'rooms', code);
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(roomRef);
      if (!snap.exists()) return;
      const r = snap.data() as Record<string, unknown>;
      if (
        r.status === 'countdown' &&
        Number(r.countdownEndsAtMs || 0) > 0 &&
        Date.now() >= Number(r.countdownEndsAtMs)
      ) {
        tx.update(roomRef, {
          status: 'active',
          updatedAt: serverTimestamp(),
        });
      }
    });
  } catch {
    // Another participant may transition simultaneously; ignore race conflict
  }
}

export async function updateArenaLiveProgress(
  rawCode: string,
  liveState: LiveState,
  focusSeconds: number,
  activeTaskTitle?: string,
): Promise<void> {
  const fbUser = auth.currentUser;
  if (!fbUser) return;
  const code = rawCode.trim().toUpperCase();
  const partRef = doc(db, 'rooms', code, 'participants', fbUser.uid);
  try {
    const snap = await getDoc(partRef);
    if (!snap.exists()) return;
    const d = snap.data() as Record<string, unknown>;
    const nextFocusSec = Math.max(
      Number(d.focusSeconds || 0),
      Math.min(14400, Math.round(focusSeconds)),
    );
    const nextScore = computeSprintScore({
      solvedCount: Number(d.solvedCount || 0),
      leftOnTimeCount: Number(d.leftOnTimeCount || 0),
      overtimeCount: Number(d.overtimeCount || 0),
      focusSeconds: nextFocusSec,
      tasksCompleted: Number(d.tasksCompleted || 0),
    });
    const cleanTask =
      activeTaskTitle !== undefined
        ? activeTaskTitle.trim().replace(/\s+/g, ' ').slice(0, 60)
        : String(d.activeTaskTitle || '').slice(0, 60);
    await updateDoc(partRef, {
      liveState,
      focusSeconds: nextFocusSec,
      sprintScore: nextScore,
      activeTaskTitle: cleanTask,
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Ignore transient heartbeat errors if room already finished
  }
}

export async function finishArenaRoom(rawCode: string): Promise<void> {
  const fbUser = auth.currentUser;
  if (!fbUser) throw new Error('Sign in required.');
  const code = rawCode.trim().toUpperCase();
  const roomRef = doc(db, 'rooms', code);

  try {
    const initialRoomSnap = await getDoc(roomRef);
    if (!initialRoomSnap.exists()) return;
    const initialRoom = initialRoomSnap.data() as Record<string, unknown>;
    const pIds = Array.isArray(initialRoom.participantIds)
      ? (initialRoom.participantIds as string[])
      : [];
    const partSnaps = await Promise.all(
      pIds.map((pUid) =>
        getDoc(doc(db, 'rooms', code, 'participants', pUid)).catch(() => null),
      ),
    );
    const participants = partSnaps
      .filter((s): s is NonNullable<typeof s> => Boolean(s && s.exists()))
      .map((s) => s.data() as Record<string, unknown>)
      .sort((a, b) => {
        const diffScore = Number(b.sprintScore || 0) - Number(a.sprintScore || 0);
        if (diffScore !== 0) return diffScore;
        const diffSolved = Number(b.solvedCount || 0) - Number(a.solvedCount || 0);
        if (diffSolved !== 0) return diffSolved;
        return Number(b.leftOnTimeCount || 0) - Number(a.leftOnTimeCount || 0);
      });

    const winner = participants[0] || null;
    await purgeRoomMessages(code);
    await runTransaction(db, async (tx) => {
      const roomSnap = await tx.get(roomRef);
      if (!roomSnap.exists()) return;
      const r = roomSnap.data() as Record<string, unknown>;
      if (r.status === 'finished') return;

      tx.update(roomRef, {
        status: 'finished',
        winnerUserId: winner ? String(winner.uid || '').slice(0, 128) : '',
        winnerDisplayName: winner ? String(winner.displayName || '').slice(0, 24) : '',
        updatedAt: serverTimestamp(),
      });
    });
    void purgeRoomMessages(code);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `rooms/${code}`);
  }
}

export async function claimDuelOutcome(room: RoomSnapshot): Promise<ArenaUser | null> {
  const fbUser = auth.currentUser;
  if (!fbUser || room.status !== 'finished' || room.mode !== 'sprint_1v1') {
    return null;
  }
  if (room.participants.length < 2) return null;

  const uid = fbUser.uid;
  const actId = sanitizeId(`duel_res_${room.roomCode}`);
  const actRef = doc(db, 'players', uid, 'activities', actId);
  const playerRef = doc(db, 'players', uid);
  const isWinner = room.winnerUserId === uid;
  const bonusXp = isWinner ? 50 : 0;

  try {
    const updated = await runTransaction(db, async (tx) => {
      const actSnap = await tx.get(actRef);
      const playerSnap = await tx.get(playerRef);
      if (!playerSnap.exists() || actSnap.exists()) {
        return null;
      }
      const pData = playerSnap.data() as Record<string, unknown>;
      const tKey = todayStr(0);
      const wKey = weekStartStr();
      const prevTodayXp = pData.todayKey === tKey ? Number(pData.todayXp || 0) : 0;
      const prevWeekXp = pData.weekKey === wKey ? Number(pData.weekXp || 0) : 0;

      const nextFields = {
        xp: Number(pData.xp || 0) + bonusXp,
        duelWins: Number(pData.duelWins || 0) + (isWinner ? 1 : 0),
        duelPlayed: Number(pData.duelPlayed || 0) + 1,
        todayKey: tKey,
        todayXp: prevTodayXp + bonusXp,
        weekKey: wKey,
        weekXp: prevWeekXp + bonusXp,
        updatedAt: serverTimestamp(),
      };

      tx.set(actRef, {
        uid,
        clientSessionId: actId,
        kind: 'duel_win_bonus',
        roomCode: room.roomCode,
        subject: room.subject.slice(0, 32),
        xpDelta: bonusXp,
        focusMinutesDelta: 0,
        solvedDelta: 0,
        leftOnTimeDelta: 0,
        overtimeDelta: 0,
        mockAccuracy: 0,
        createdAt: serverTimestamp(),
      });
      tx.update(playerRef, nextFields);
      return toArenaUser({...pData, ...nextFields});
    });
    return updated;
  } catch {
    return null;
  }
}

function mapRoomDoc(
  r: Record<string, unknown>,
  parts: Record<string, unknown>[],
): RoomSnapshot {
  const sortedParts: RoomParticipantView[] = parts
    .map((p) => ({
      userId: String(p.uid || ''),
      username: String(p.username || 'player'),
      displayName: String(p.displayName || 'Player'),
      streakDays: Number(p.streakDays || 0),
      isHost: Boolean(p.isHost),
      ready: Boolean(p.ready),
      liveState: (p.liveState as LiveState) || 'idle',
      solvedCount: Number(p.solvedCount || 0),
      leftOnTimeCount: Number(p.leftOnTimeCount || 0),
      overtimeCount: Number(p.overtimeCount || 0),
      focusSeconds: Number(p.focusSeconds || 0),
      sprintScore: Number(p.sprintScore || 0),
      tasksCompleted: Number(p.tasksCompleted || 0),
      activeTaskTitle: p.activeTaskTitle ? String(p.activeTaskTitle) : '',
    }))
    .sort((a, b) => {
      if (b.sprintScore !== a.sprintScore) return b.sprintScore - a.sprintScore;
      return b.solvedCount - a.solvedCount;
    });

  return {
    roomCode: String(r.roomCode || ''),
    mode: (r.mode as RoomMode) || 'study_room',
    title: String(r.title || ''),
    subject: String(r.subject || 'General'),
    durationSec: Number(r.durationSec || 1500),
    questionLimitSec: Number(r.questionLimitSec || 90),
    status: (r.status as RoomStatus) || 'lobby',
    hostUserId: String(r.hostUserId || ''),
    hostDisplayName: String(r.hostDisplayName || ''),
    maxPlayers: Number(r.maxPlayers || 2),
    isPublic: Boolean(r.isPublic),
    countdownEndsAt: Number(r.countdownEndsAtMs || 0) || null,
    startedAt: Number(r.startedAtMs || 0) || null,
    endsAt: Number(r.endsAtMs || 0) || null,
    winnerUserId: r.winnerUserId ? String(r.winnerUserId) : null,
    winnerDisplayName: r.winnerDisplayName ? String(r.winnerDisplayName) : null,
    participants: sortedParts,
  };
}

export async function fetchRoomSnapshot(
  rawCode: string,
): Promise<RoomSnapshot | null> {
  const fbUser = auth.currentUser;
  if (!fbUser) return null;
  const code = rawCode.trim().toUpperCase();
  const roomRef = doc(db, 'rooms', code);
  try {
    const rSnap = await getDoc(roomRef);
    if (!rSnap.exists()) return null;
    const rData = rSnap.data() as Record<string, unknown>;
    const pIds = Array.isArray(rData.participantIds)
      ? (rData.participantIds as string[])
      : [];
    const partSnaps = await Promise.all(
      pIds.map((pUid) =>
        getDoc(doc(db, 'rooms', code, 'participants', pUid)).catch(() => null),
      ),
    );
    const parts = partSnaps
      .filter((s): s is NonNullable<typeof s> => Boolean(s && s.exists()))
      .map((s) => s.data() as Record<string, unknown>);
    return mapRoomDoc(rData, parts);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `rooms/${code}`);
  }
}

export function subscribePublicRooms(
  cb: (rooms: PublicRoomSummary[]) => void,
  onError?: (msg: string) => void,
): Unsubscribe {
  const fbUser = auth.currentUser;
  if (!fbUser) {
    cb([]);
    return () => {};
  }
  const q = query(
    collection(db, 'rooms'),
    where('isPublic', '==', true),
    limit(80),
  );
  return onSnapshot(
    q,
    (snap) => {
      const list: PublicRoomSummary[] = snap.docs
        .map((d) => d.data() as Record<string, unknown>)
        .filter((r) => r.status !== 'finished')
        .sort((a, b) => {
          const at =
            (a.createdAt as {toMillis?: () => number} | undefined)?.toMillis?.() ||
            0;
          const bt =
            (b.createdAt as {toMillis?: () => number} | undefined)?.toMillis?.() ||
            0;
          return bt - at;
        })
        .map((r) => ({
          roomCode: String(r.roomCode || ''),
          mode: (r.mode as RoomMode) || 'study_room',
          title: String(r.title || ''),
          subject: String(r.subject || 'General'),
          durationSec: Number(r.durationSec || 1500),
          questionLimitSec: Number(r.questionLimitSec || 90),
          status: (r.status as RoomStatus) || 'lobby',
          hostDisplayName: String(r.hostDisplayName || ''),
          maxPlayers: Number(r.maxPlayers || 2),
          participantCount: Number(r.participantCount || 1),
        }));
      cb(list);
    },
    (error) => {
      const friendly = reportFirestoreListenerError(error, OperationType.LIST, 'rooms');
      onError?.(friendly);
    },
  );
}

export function subscribeRoom(
  rawCode: string,
  cb: (room: RoomSnapshot | null) => void,
  onError?: (msg: string) => void,
): Unsubscribe {
  const fbUser = auth.currentUser;
  if (!fbUser) {
    cb(null);
    return () => {};
  }
  const code = rawCode.trim().toUpperCase();
  const roomRef = doc(db, 'rooms', code);

  let latestRoom: Record<string, unknown> | null = null;
  const partMap = new Map<string, Record<string, unknown>>();
  const partUnsubs = new Map<string, Unsubscribe>();
  let disposed = false;

  const emit = () => {
    if (disposed) return;
    if (!latestRoom) {
      cb(null);
      return;
    }
    const pIds = Array.isArray(latestRoom.participantIds)
      ? (latestRoom.participantIds as string[])
      : [];
    const parts = pIds
      .map((id) => partMap.get(id))
      .filter((p): p is Record<string, unknown> => Boolean(p));
    cb(mapRoomDoc(latestRoom, parts));
  };

  const syncParticipantListeners = (participantIds: string[]) => {
    const targetSet = new Set(participantIds);
    for (const [pUid, unsub] of partUnsubs.entries()) {
      if (!targetSet.has(pUid)) {
        try {
          unsub();
        } catch {
          // Ignore unsub error
        }
        partUnsubs.delete(pUid);
        partMap.delete(pUid);
      }
    }
    for (const pUid of participantIds) {
      if (partUnsubs.has(pUid)) continue;
      const pRef = doc(db, 'rooms', code, 'participants', pUid);
      const unsub = onSnapshot(
        pRef,
        (pSnap) => {
          if (pSnap.exists()) {
            partMap.set(pUid, pSnap.data() as Record<string, unknown>);
          } else {
            partMap.delete(pUid);
          }
          emit();
        },
        (error) => {
          const curIds =
            latestRoom && Array.isArray(latestRoom.participantIds)
              ? (latestRoom.participantIds as string[])
              : [];
          if (!curIds.includes(pUid)) return;
          const friendly = reportFirestoreListenerError(
            error,
            OperationType.GET,
            `rooms/${code}/participants/${pUid}`,
          );
          onError?.(friendly);
        },
      );
      partUnsubs.set(pUid, unsub);
    }
  };

  const unsubRoom = onSnapshot(
    roomRef,
    (snap) => {
      latestRoom = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
      const pIds =
        latestRoom && Array.isArray(latestRoom.participantIds)
          ? (latestRoom.participantIds as string[])
          : [];
      syncParticipantListeners(pIds);
      emit();
    },
    (error) => {
      const friendly = reportFirestoreListenerError(
        error,
        OperationType.GET,
        `rooms/${code}`,
      );
      onError?.(friendly);
    },
  );

  return () => {
    disposed = true;
    try {
      unsubRoom();
    } catch {
      // Ignore unsub error
    }
    for (const unsub of partUnsubs.values()) {
      try {
        unsub();
      } catch {
        // Ignore unsub error
      }
    }
    partUnsubs.clear();
    partMap.clear();
  };
}

export async function fetchLeaderboard(opts: {
  sort: LeaderboardSort;
  timeframe: LeaderboardTimeframe;
  search: string;
}): Promise<LeaderboardEntry[]> {
  const fbUser = auth.currentUser;
  if (!fbUser) return [];

  try {
    const q = query(
      collection(db, 'players'),
      where('xp', '>=', 0),
      orderBy('xp', 'desc'),
      limit(100),
    );
    const snap = await getDocs(q);
    const players = snap.docs.map((d) =>
      toArenaUser(d.data() as Record<string, unknown>),
    );

    const searchLower = (opts.search || '').trim().toLowerCase();
    const mapped = players
      .map((u) => {
        const xp =
          opts.timeframe === 'today'
            ? u.todayXp
            : opts.timeframe === '7d'
              ? u.weekXp
              : u.xp;
        const focusMinutes =
          opts.timeframe === 'today'
            ? u.todayFocusMinutes
            : opts.timeframe === '7d'
              ? u.weekFocusMinutes
              : u.focusMinutes;
        const questionsSolved =
          opts.timeframe === 'today'
            ? u.todayQuestionsSolved
            : opts.timeframe === '7d'
              ? u.weekQuestionsSolved
              : u.questionsSolved;
        return {
          ...u,
          xp,
          focusMinutes,
          questionsSolved,
        };
      })
      .filter((u) => {
        if (opts.timeframe !== 'all' && u.xp === 0 && u.focusMinutes === 0 && u.questionsSolved === 0) {
          return false;
        }
        if (!searchLower) return true;
        return (
          u.username.toLowerCase().includes(searchLower) ||
          u.displayName.toLowerCase().includes(searchLower)
        );
      })
      .sort((a, b) => {
        if (opts.sort === 'focus') {
          if (b.focusMinutes !== a.focusMinutes) return b.focusMinutes - a.focusMinutes;
          if (b.streakDays !== a.streakDays) return b.streakDays - a.streakDays;
          return b.xp - a.xp;
        }
        if (opts.sort === 'questions') {
          if (b.questionsSolved !== a.questionsSolved) {
            return b.questionsSolved - a.questionsSolved;
          }
          if (b.mockAccuracyAvg !== a.mockAccuracyAvg) {
            return b.mockAccuracyAvg - a.mockAccuracyAvg;
          }
          return b.xp - a.xp;
        }
        if (opts.sort === 'duels') {
          if (b.duelWins !== a.duelWins) return b.duelWins - a.duelWins;
          if (b.duelPlayed !== a.duelPlayed) return b.duelPlayed - a.duelPlayed;
          return b.xp - a.xp;
        }
        if (b.xp !== a.xp) return b.xp - a.xp;
        return b.focusMinutes - a.focusMinutes;
      });

    return mapped.map((u, idx) => ({
      rank: idx + 1,
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      xp: u.xp,
      focusMinutes: u.focusMinutes,
      streakDays: u.streakDays,
      questionsSolved: u.questionsSolved,
      questionsLeftOnTime: u.questionsLeftOnTime,
      questionsOvertime: u.questionsOvertime,
      solveRatePct: u.solveRatePct,
      disciplineRatePct: u.disciplineRatePct,
      mockTestsCount: u.mockTestsCount,
      mockAccuracyAvg: u.mockAccuracyAvg,
      duelWins: u.duelWins,
      duelPlayed: u.duelPlayed,
      tasksCompleted: u.tasksCompleted,
    }));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'players');
  }
}

function sanitizeBackupValue(val: unknown, depth = 0): unknown {
  if (depth > 8) return null;
  if (val === null || typeof val === 'boolean' || typeof val === 'string') {
    return typeof val === 'string' && val.length > 20000
      ? val.slice(0, 20000)
      : val;
  }
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : 0;
  }
  if (Array.isArray(val)) {
    const capped = val.length > 2000 ? val.slice(-2000) : val;
    return capped.map((item) => sanitizeBackupValue(item, depth + 1));
  }
  if (typeof val === 'object') {
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v === undefined || typeof v === 'function' || typeof v === 'symbol') {
        continue;
      }
      if (!k || k.length > 120) continue;
      out[k] = sanitizeBackupValue(v, depth + 1);
      count++;
      if (count >= 1500) break;
    }
    return out;
  }
  return null;
}

function sanitizeBackupMap(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let keys = 0;
  for (const [k, v] of Object.entries(raw || {})) {
    if (!/^[a-zA-Z0-9_.\-]{1,48}$/.test(k)) continue;
    if (v === undefined) continue;
    out[k] = sanitizeBackupValue(v, 0);
    keys++;
    if (keys >= 38) break;
  }
  return out;
}

export async function loadAccountBackup(): Promise<{
  storage: Record<string, unknown>;
  guestMergedAtMs: number;
  updatedAtMs: number;
} | null> {
  const fbUser = auth.currentUser;
  if (!fbUser) return null;
  const path = `players/${fbUser.uid}/backup/snapshot`;
  const ref = doc(db, 'players', fbUser.uid, 'backup', 'snapshot');
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const d = snap.data() as Record<string, unknown>;
    const updatedAt = d.updatedAt as {toMillis?: () => number} | undefined;
    return {
      storage:
        d.storage && typeof d.storage === 'object' && !Array.isArray(d.storage)
          ? (d.storage as Record<string, unknown>)
          : {},
      guestMergedAtMs: Number(d.guestMergedAtMs || 0),
      updatedAtMs:
        updatedAt && typeof updatedAt.toMillis === 'function'
          ? updatedAt.toMillis()
          : 0,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function saveAccountBackup(params: {
  storage: Record<string, unknown>;
  guestMergedAtMs?: number;
}): Promise<void> {
  const fbUser = auth.currentUser;
  if (!fbUser) return;
  const uid = fbUser.uid;
  const path = `players/${uid}/backup/snapshot`;
  const playerRef = doc(db, 'players', uid);
  const backupRef = doc(db, 'players', uid, 'backup', 'snapshot');
  const cleanStorage = sanitizeBackupMap(params.storage);
  const mergedAt = Math.max(0, Math.floor(params.guestMergedAtMs || 0));

  try {
    await ensurePlayerProfile(fbUser);
    await runTransaction(db, async (tx) => {
      const playerSnap = await tx.get(playerRef);
      if (!playerSnap.exists()) {
        throw new Error('Player profile not initialized yet.');
      }
      const existingSnap = await tx.get(backupRef);
      if (!existingSnap.exists()) {
        tx.set(backupRef, {
          uid,
          version: 1,
          guestMergedAtMs: mergedAt || Date.now(),
          storage: cleanStorage,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        const prev = existingSnap.data() as Record<string, unknown>;
        tx.update(backupRef, {
          version: 1,
          guestMergedAtMs: mergedAt || Number(prev.guestMergedAtMs || 0),
          storage: cleanStorage,
          updatedAt: serverTimestamp(),
        });
      }
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function importGuestSummaryStats(summary: {
  xp: number;
  focusMinutes: number;
  streakDays: number;
  lastActiveDate: string;
  questionsSolved: number;
  questionsLeftOnTime: number;
  questionsOvertime: number;
  mockTestsCount: number;
  mockAccuracySum: number;
  todayXp: number;
  todayFocusMinutes: number;
  todayQuestionsSolved: number;
  weekXp: number;
  weekFocusMinutes: number;
  weekQuestionsSolved: number;
}): Promise<ArenaUser | null> {
  const fbUser = auth.currentUser;
  if (!fbUser) return null;
  const uid = fbUser.uid;
  const path = `players/${uid}`;
  const playerRef = doc(db, 'players', uid);

  const clamp = (n: number, max: number) =>
    Math.max(0, Math.min(max, Math.round(Number(n) || 0)));

  const xp = clamp(summary.xp, 15000);
  const focusMinutes = clamp(summary.focusMinutes, 10000);
  const questionsSolved = clamp(summary.questionsSolved, 3000);
  const questionsLeftOnTime = clamp(summary.questionsLeftOnTime, 3000);
  const questionsOvertime = clamp(summary.questionsOvertime, 3000);
  const mockTestsCount = clamp(summary.mockTestsCount, 500);
  const mockAccuracySum = Math.max(
    0,
    Math.min(50000, Math.round((Number(summary.mockAccuracySum) || 0) * 10) / 10),
  );
  const streakDays = clamp(summary.streakDays, 3650);

  if (
    xp === 0 &&
    focusMinutes === 0 &&
    questionsSolved === 0 &&
    mockTestsCount === 0
  ) {
    return null;
  }

  try {
    await ensurePlayerProfile(fbUser);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(playerRef);
      if (!snap.exists()) return;
      const cur = snap.data() as Record<string, unknown>;
      if (
        Number(cur.xp || 0) !== 0 ||
        Number(cur.questionsSolved || 0) !== 0 ||
        Number(cur.focusMinutes || 0) !== 0 ||
        Number(cur.mockTestsCount || 0) !== 0
      ) {
        return;
      }
      const tKey = todayStr(0);
      const wKey = weekStartStr();
      const lastDate = String(summary.lastActiveDate || '').slice(0, 10);
      tx.update(playerRef, {
        xp,
        focusMinutes,
        streakDays,
        lastActiveDate: lastDate,
        questionsSolved,
        questionsLeftOnTime,
        questionsOvertime,
        mockTestsCount,
        mockAccuracySum,
        todayKey: tKey,
        todayXp: clamp(summary.todayXp, 15000),
        todayFocusMinutes: clamp(summary.todayFocusMinutes, 10000),
        todayQuestionsSolved: clamp(summary.todayQuestionsSolved, 3000),
        weekKey: wKey,
        weekXp: clamp(summary.weekXp, 15000),
        weekFocusMinutes: clamp(summary.weekFocusMinutes, 10000),
        weekQuestionsSolved: clamp(summary.weekQuestionsSolved, 3000),
        updatedAt: serverTimestamp(),
      });
    });
    const fresh = await getDoc(playerRef);
    return fresh.exists()
      ? toArenaUser(fresh.data() as Record<string, unknown>)
      : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

function canonicalPairId(uidA: string, uidB: string): [string, string, string] {
  const sorted = uidA < uidB ? [uidA, uidB] : [uidB, uidA];
  return [sorted[0], sorted[1], `${sorted[0]}_${sorted[1]}`];
}

export async function sendFriendRequest(
  target: string | {uid?: string; username?: string},
): Promise<{
  status: FriendshipStatus;
  username: string;
  displayName: string;
  pairId: string;
}> {
  const fbUser = auth.currentUser;
  if (!fbUser) throw new Error('Sign in required.');
  const myUid = fbUser.uid;
  const myProfile = await ensurePlayerProfile(fbUser);

  const opts =
    typeof target === 'string'
      ? {username: target}
      : target || {};

  let targetData: Record<string, unknown> | null = null;
  if (opts.uid) {
    const tSnap = await getDoc(doc(db, 'players', opts.uid)).catch(() => null);
    if (tSnap && tSnap.exists()) {
      targetData = tSnap.data() as Record<string, unknown>;
    }
  } else {
    const handle = String(opts.username || '')
      .trim()
      .replace(/^@+/, '')
      .toLowerCase();
    if (!/^[a-z0-9_.]{3,20}$/.test(handle)) {
      throw new Error(
        'Enter a valid @username (3–20 lowercase letters, numbers, _ or .).',
      );
    }
    try {
      const q = query(
        collection(db, 'players'),
        where('username', '==', handle),
        limit(3),
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        targetData = snap.docs[0].data() as Record<string, unknown>;
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'players');
    }
  }

  if (!targetData) {
    throw new Error('No verified player found with that @username.');
  }

  const targetUid = String(targetData.uid || '');
  const targetUsername = String(targetData.username || 'player');
  const targetDisplayName = sanitizeDisplayName(
    String(targetData.displayName || targetUsername),
  );

  if (!targetUid || targetUid === myUid) {
    throw new Error("You can't add yourself as a friend.");
  }

  const [u0, u1, pairId] = canonicalPairId(myUid, targetUid);
  const pairRef = doc(db, 'friendships', pairId);

  try {
    const out = await runTransaction(db, async (tx) => {
      const snap = await tx.get(pairRef);
      if (snap.exists()) {
        const cur = snap.data() as Record<string, unknown>;
        if (cur.status === 'accepted') {
          throw new Error(`@${targetUsername} is already your friend.`);
        }
        if (cur.status === 'pending' && cur.recipientUid === myUid) {
          tx.update(pairRef, {
            status: 'accepted',
            updatedAt: serverTimestamp(),
          });
          return {
            status: 'accepted' as FriendshipStatus,
            username: targetUsername,
            displayName: targetDisplayName,
            pairId,
          };
        }
        throw new Error(`Friend request already pending with @${targetUsername}.`);
      }

      tx.set(pairRef, {
        pairId,
        users: [u0, u1],
        requesterUid: myUid,
        recipientUid: targetUid,
        requesterUsername: myProfile.username,
        requesterDisplayName: myProfile.displayName,
        recipientUsername: targetUsername,
        recipientDisplayName: targetDisplayName,
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return {
        status: 'pending' as FriendshipStatus,
        username: targetUsername,
        displayName: targetDisplayName,
        pairId,
      };
    });
    return out;
  } catch (error) {
    if (error instanceof Error && !error.message.toLowerCase().includes('permission')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, `friendships/${pairId}`);
  }
}

export async function acceptFriendRequest(pairId: string): Promise<void> {
  const fbUser = auth.currentUser;
  if (!fbUser) throw new Error('Sign in required.');
  const cleanPair = sanitizeId(pairId);
  try {
    await updateDoc(doc(db, 'friendships', cleanPair), {
      status: 'accepted',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `friendships/${cleanPair}`);
  }
}

export async function removeFriendship(pairId: string): Promise<void> {
  const fbUser = auth.currentUser;
  if (!fbUser) throw new Error('Sign in required.');
  const cleanPair = sanitizeId(pairId);
  try {
    await deleteDoc(doc(db, 'friendships', cleanPair));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `friendships/${cleanPair}`);
  }
}

export function subscribeFriends(
  cb: (friends: FriendEntry[]) => void,
  onError?: (msg: string) => void,
): Unsubscribe {
  const fbUser = auth.currentUser;
  if (!fbUser) {
    cb([]);
    return () => {};
  }
  const myUid = fbUser.uid;
  const q = query(
    collection(db, 'friendships'),
    where('users', 'array-contains', myUid),
    limit(120),
  );
  return onSnapshot(
    q,
    (snap) => {
      const list: FriendEntry[] = snap.docs
        .map((d) => {
          const r = d.data() as Record<string, unknown>;
          const isRequester = r.requesterUid === myUid;
          const status = (r.status === 'accepted' ? 'accepted' : 'pending') as FriendshipStatus;
          const direction: FriendDirection =
            status === 'accepted'
              ? 'friend'
              : isRequester
                ? 'outgoing'
                : 'incoming';
          const createdTs = r.createdAt as {toMillis?: () => number} | undefined;
          return {
            pairId: String(r.pairId || d.id),
            uid: String(isRequester ? r.recipientUid : r.requesterUid),
            username: String(
              isRequester ? r.recipientUsername : r.requesterUsername,
            ),
            displayName: String(
              isRequester ? r.recipientDisplayName : r.requesterDisplayName,
            ),
            status,
            direction,
            createdAtMs:
              createdTs && typeof createdTs.toMillis === 'function'
                ? createdTs.toMillis()
                : 0,
          };
        })
        .sort((a, b) => {
          const order: Record<FriendDirection, number> = {
            incoming: 0,
            friend: 1,
            outgoing: 2,
          };
          if (order[a.direction] !== order[b.direction]) {
            return order[a.direction] - order[b.direction];
          }
          return a.displayName.localeCompare(b.displayName);
        });
      cb(list);
    },
    (error) => {
      const friendly = reportFirestoreListenerError(
        error,
        OperationType.LIST,
        'friendships',
      );
      onError?.(friendly);
    },
  );
}

export async function fetchFriendProfiles(uids: string[]): Promise<ArenaUser[]> {
  const fbUser = auth.currentUser;
  if (!fbUser || !Array.isArray(uids) || uids.length === 0) return [];
  const uniq = Array.from(new Set(uids.filter(Boolean))).slice(0, 40);
  const snaps = await Promise.all(
    uniq.map((u) => getDoc(doc(db, 'players', u)).catch(() => null)),
  );
  return snaps
    .filter((s): s is NonNullable<typeof s> => Boolean(s && s.exists()))
    .map((s) => toArenaUser(s.data() as Record<string, unknown>));
}

export async function sendRoomInvite(params: {
  friendUid: string;
  roomCode: string;
}): Promise<void> {
  const fbUser = auth.currentUser;
  if (!fbUser) throw new Error('Sign in required.');
  const myUid = fbUser.uid;
  const toUid = String(params.friendUid || '').trim();
  const code = String(params.roomCode || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!toUid || toUid === myUid) throw new Error('Choose a valid friend.');
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error('Invalid room code.');

  const myProfile = await ensurePlayerProfile(fbUser);
  const roomSnap = await getDoc(doc(db, 'rooms', code));
  if (!roomSnap.exists()) throw new Error('Room not found.');
  const r = roomSnap.data() as Record<string, unknown>;
  if (r.status === 'finished') throw new Error('This match has already finished.');

  const invId = sanitizeId(
    `inv_${code}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
  );
  try {
    await setDoc(doc(db, 'friendInvites', invId), {
      id: invId,
      fromUid: myUid,
      fromUsername: myProfile.username,
      fromDisplayName: myProfile.displayName,
      toUid,
      roomCode: code,
      roomTitle: String(r.title || 'Arena Room').slice(0, 48),
      roomMode: (r.mode === 'sprint_1v1' ? 'sprint_1v1' : 'study_room') as RoomMode,
      roomSubject: String(r.subject || 'General').slice(0, 24),
      createdAtMs: Date.now(),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `friendInvites/${invId}`);
  }
}

export async function dismissRoomInvite(inviteId: string): Promise<void> {
  const fbUser = auth.currentUser;
  if (!fbUser || !inviteId) return;
  try {
    await deleteDoc(doc(db, 'friendInvites', sanitizeId(inviteId)));
  } catch {
    // Ignore already dismissed
  }
}

export function subscribeRoomInvites(
  cb: (invites: FriendInviteView[]) => void,
  onError?: (msg: string) => void,
): Unsubscribe {
  const fbUser = auth.currentUser;
  if (!fbUser) {
    cb([]);
    return () => {};
  }
  const q = query(
    collection(db, 'friendInvites'),
    where('toUid', '==', fbUser.uid),
    limit(20),
  );
  return onSnapshot(
    q,
    (snap) => {
      const cutoff = Date.now() - 3 * 3600 * 1000;
      const list: FriendInviteView[] = snap.docs
        .map((d) => {
          const r = d.data() as Record<string, unknown>;
          return {
            id: String(r.id || d.id),
            fromUid: String(r.fromUid || ''),
            fromUsername: String(r.fromUsername || 'friend'),
            fromDisplayName: String(r.fromDisplayName || 'Friend'),
            toUid: String(r.toUid || ''),
            roomCode: String(r.roomCode || ''),
            roomTitle: String(r.roomTitle || 'Arena Room'),
            roomMode: (r.roomMode === 'sprint_1v1' ? 'sprint_1v1' : 'study_room') as RoomMode,
            roomSubject: String(r.roomSubject || 'General'),
            createdAtMs: Number(r.createdAtMs || 0),
          };
        })
        .filter((inv) => inv.roomCode.length === 6 && inv.createdAtMs >= cutoff)
        .sort((a, b) => b.createdAtMs - a.createdAtMs);
      cb(list);
    },
    (error) => {
      const friendly = reportFirestoreListenerError(
        error,
        OperationType.LIST,
        'friendInvites',
      );
      onError?.(friendly);
    },
  );
}

export async function sendRoomMessage(params: {
  roomCode: string;
  text: string;
  kind?: RoomMessageKind;
}): Promise<void> {
  const fbUser = auth.currentUser;
  if (!fbUser) throw new Error('Sign in required.');
  const code = String(params.roomCode || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error('Invalid room code.');
  const cleanText = String(params.text || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 140);
  if (!cleanText) return;
  const kind: RoomMessageKind =
    params.kind === 'rivalry' || params.kind === 'cheer' ? params.kind : 'chat';

  const myProfile = await ensurePlayerProfile(fbUser);
  const roomRef = doc(db, 'rooms', code);
  const roomSnap = await getDoc(roomRef);
  if (!roomSnap.exists()) throw new Error('Room not found.');
  const r = roomSnap.data() as Record<string, unknown>;
  if (r.status === 'finished') {
    throw new Error('Session already ended — chat is closed.');
  }
  const pIds = Array.isArray(r.participantIds)
    ? (r.participantIds as string[]).filter(Boolean).slice(0, 20)
    : [];
  if (!pIds.includes(fbUser.uid)) {
    throw new Error('Join the room before sending messages.');
  }

  const msgId = sanitizeId(
    `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  );
  const msgPath = `rooms/${code}/messages/${msgId}`;
  try {
    await setDoc(doc(db, 'rooms', code, 'messages', msgId), {
      id: msgId,
      roomCode: code,
      senderUid: fbUser.uid,
      senderUsername: myProfile.username,
      senderDisplayName: myProfile.displayName,
      allowedUids: pIds,
      kind,
      text: cleanText,
      createdAtMs: Date.now(),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, msgPath);
  }
}

export async function purgeRoomMessages(rawCode: string): Promise<void> {
  const fbUser = auth.currentUser;
  if (!fbUser) return;
  const code = String(rawCode || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z0-9]{6}$/.test(code)) return;

  const uid = fbUser.uid;
  const refsToDelete = new Map<string, ReturnType<typeof doc>>();
  try {
    const [qAllowed, qMine] = await Promise.all([
      getDocs(
        query(
          collection(db, 'rooms', code, 'messages'),
          where('allowedUids', 'array-contains', uid),
          limit(200),
        ),
      ).catch(() => null),
      getDocs(
        query(
          collection(db, 'rooms', code, 'messages'),
          where('senderUid', '==', uid),
          limit(200),
        ),
      ).catch(() => null),
    ]);
    qAllowed?.docs.forEach((d) => refsToDelete.set(d.id, d.ref));
    qMine?.docs.forEach((d) => refsToDelete.set(d.id, d.ref));
  } catch {
    return;
  }

  const allRefs = Array.from(refsToDelete.values());
  if (!allRefs.length) return;
  for (let i = 0; i < allRefs.length; i += 400) {
    const batch = writeBatch(db);
    allRefs.slice(i, i + 400).forEach((ref) => batch.delete(ref));
    await batch.commit().catch(() => {});
  }
}

export function subscribeRoomMessages(
  rawCode: string,
  cb: (messages: RoomMessageView[]) => void,
  onError?: (msg: string) => void,
): Unsubscribe {
  const fbUser = auth.currentUser;
  const code = String(rawCode || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!fbUser || !/^[A-Z0-9]{6}$/.test(code)) {
    cb([]);
    return () => {};
  }
  const q = query(
    collection(db, 'rooms', code, 'messages'),
    where('allowedUids', 'array-contains', fbUser.uid),
    limit(80),
  );
  return onSnapshot(
    q,
    (snap) => {
      const list: RoomMessageView[] = snap.docs
        .map((d) => {
          const r = d.data() as Record<string, unknown>;
          const kind: RoomMessageKind =
            r.kind === 'rivalry' || r.kind === 'cheer' ? r.kind : 'chat';
          return {
            id: String(r.id || d.id),
            roomCode: String(r.roomCode || code),
            senderUid: String(r.senderUid || ''),
            senderUsername: String(r.senderUsername || 'player'),
            senderDisplayName: String(r.senderDisplayName || 'Player'),
            kind,
            text: String(r.text || ''),
            createdAtMs: Number(r.createdAtMs || 0),
          };
        })
        .sort((a, b) => a.createdAtMs - b.createdAtMs)
        .slice(-60);
      cb(list);
    },
    (error) => {
      const friendly = reportFirestoreListenerError(
        error,
        OperationType.LIST,
        `rooms/${code}/messages`,
      );
      onError?.(friendly);
    },
  );
}

export const firebaseArenaBridge = {
  signInWithGoogle: signInArenaWithGoogle,
  sendEmailSignInLink,
  isPendingEmailLinkSignIn,
  completeEmailLinkIfPresent,
  signOut: signOutArena,
  subscribeAuth: subscribeArenaAuth,
  updateProfile: updateArenaProfile,
  recordActivity: recordArenaActivity,
  createRoom: createArenaRoom,
  joinRoom: joinArenaRoom,
  leaveRoom: leaveArenaRoom,
  setReady: setArenaReady,
  startRoom: startArenaRoom,
  activateRoomIfDue: activateArenaRoomIfDue,
  updateLiveProgress: updateArenaLiveProgress,
  finishRoom: finishArenaRoom,
  claimDuelOutcome,
  subscribePublicRooms,
  subscribeRoom,
  fetchLeaderboard,
  loadAccountBackup,
  saveAccountBackup,
  importGuestSummaryStats,
  sendFriendRequest,
  acceptFriendRequest,
  removeFriendship,
  subscribeFriends,
  fetchFriendProfiles,
  sendRoomInvite,
  dismissRoomInvite,
  subscribeRoomInvites,
  sendRoomMessage,
  purgeRoomMessages,
  subscribeRoomMessages,
  getDiagnostics: () => ({
    logs: getArenaLogs(),
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    projectId: firebaseConfig.projectId,
    databaseId: firebaseConfig.firestoreDatabaseId,
    uid: auth.currentUser?.uid || null,
    emailVerified: auth.currentUser?.emailVerified ?? null,
  }),
  subscribeLogs: subscribeArenaLogs,
  clearLogs: clearArenaLogs,
  logDiagnostic: recordArenaLog,
};

export type FirebaseArenaBridge = typeof firebaseArenaBridge;
