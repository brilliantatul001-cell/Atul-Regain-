import {initializeApp} from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  type User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({prompt: 'select_account'});

export {
  firebaseConfig,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  type User,
};

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export interface ArenaDiagnosticEntry {
  id: number;
  ts: number;
  level: 'error' | 'warn' | 'info';
  source: string;
  message: string;
  operationType?: string;
  path?: string | null;
  detail?: string;
}

const MAX_DIAGNOSTIC_LOGS = 50;
let diagnosticSeq = 0;
const diagnosticLogs: ArenaDiagnosticEntry[] = [];
const logListeners = new Set<(logs: ArenaDiagnosticEntry[]) => void>();

function notifyLogListeners(): void {
  const snapshot = [...diagnosticLogs];
  logListeners.forEach((cb) => {
    try {
      cb(snapshot);
    } catch {
      // Ignore subscriber error
    }
  });
}

export function recordArenaLog(
  entry: Omit<ArenaDiagnosticEntry, 'id' | 'ts'>,
): void {
  diagnosticSeq += 1;
  diagnosticLogs.unshift({
    id: diagnosticSeq,
    ts: Date.now(),
    ...entry,
  });
  if (diagnosticLogs.length > MAX_DIAGNOSTIC_LOGS) {
    diagnosticLogs.length = MAX_DIAGNOSTIC_LOGS;
  }
  notifyLogListeners();
}

export function getArenaLogs(): ArenaDiagnosticEntry[] {
  return [...diagnosticLogs];
}

export function clearArenaLogs(): void {
  diagnosticLogs.length = 0;
  notifyLogListeners();
}

export function subscribeArenaLogs(
  cb: (logs: ArenaDiagnosticEntry[]) => void,
): () => void {
  logListeners.add(cb);
  cb([...diagnosticLogs]);
  return () => {
    logListeners.delete(cb);
  };
}

export function buildFirestoreErrorInfo(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): FirestoreErrorInfo {
  return {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
}

export function formatFriendlyFirestoreError(
  error: unknown,
  operationType?: OperationType,
  path?: string | null,
): string {
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();
  if (lower.includes('the client is offline') || lower.includes('network')) {
    return 'Unable to reach Firestore while offline. Check your connection and try again.';
  }
  if (lower.includes('quota exceeded')) {
    return 'Firestore daily free-tier quota exceeded. Please try again tomorrow.';
  }
  if (lower.includes('missing or insufficient permissions') || lower.includes('permission-denied')) {
    const scope = path ? ` (${operationType || 'read'} ${path})` : '';
    return `Permission denied${scope}. Try signing out and back in, or open Diagnostics for details.`;
  }
  if (lower.includes('requires an index')) {
    return 'A Firestore index is required for this query. Open Diagnostics for details.';
  }
  return raw || 'Unexpected Firestore error.';
}

export function reportFirestoreListenerError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): string {
  const errInfo = buildFirestoreErrorInfo(error, operationType, path);
  const serialized = JSON.stringify(errInfo);
  console.error('Firestore Error: ', serialized);
  recordArenaLog({
    level: 'error',
    source: 'firestore-listener',
    message: errInfo.error,
    operationType,
    path,
    detail: serialized,
  });
  return formatFriendlyFirestoreError(error, operationType, path);
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  if (error instanceof Error && error.message.trim().startsWith('{"error":')) {
    try {
      const parsed = JSON.parse(error.message) as Partial<FirestoreErrorInfo>;
      if (parsed && typeof parsed.error === 'string' && 'operationType' in parsed) {
        throw error;
      }
    } catch (inner) {
      if (inner === error) throw error;
    }
  }
  const errInfo = buildFirestoreErrorInfo(error, operationType, path);
  const serialized = JSON.stringify(errInfo);
  console.error('Firestore Error: ', serialized);
  recordArenaLog({
    level: 'error',
    source: 'firestore',
    message: errInfo.error,
    operationType,
    path,
    detail: serialized,
  });
  throw new Error(serialized);
}

async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('the client is offline')
    ) {
      console.error('Please check your Firebase configuration.');
      recordArenaLog({
        level: 'error',
        source: 'connection-check',
        message: 'Firestore client is offline. Check Firebase configuration or network.',
        operationType: OperationType.GET,
        path: 'test/connection',
        detail: error.message,
      });
    }
  }
}

void testConnection();
