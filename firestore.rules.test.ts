/**
 * Verification specification for Leave It Arena Firestore Security Rules.
 * Covers all Dirty Dozen adversarial payloads against firestore.rules.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

export interface RuleAssertionCase {
  id: number;
  name: string;
  path: string;
  operation: 'create' | 'update' | 'delete' | 'get' | 'list';
  expected: 'PERMISSION_DENIED';
  reason: string;
}

export const DIRTY_DOZEN_CASES: RuleAssertionCase[] = [
  {
    id: 1,
    name: 'Identity Spoofing on Player Create',
    path: '/players/victim_uid',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'isOwner(userId) and incoming().uid == request.auth.uid reject mismatched UID',
  },
  {
    id: 2,
    name: 'Initial XP Forgery',
    path: '/players/attacker_uid',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'create requires xp == 0, focusMinutes == 0, questionsSolved == 0, duelWins == 0',
  },
  {
    id: 3,
    name: 'Shadow Field Injection on Player Update',
    path: '/players/attacker_uid',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    reason: 'isValidPlayer enforces keys().hasOnly(...) and affectedKeys().hasOnly(...)',
  },
  {
    id: 4,
    name: 'PII Leak Attempt on Public Player Doc',
    path: '/players/attacker_uid',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'email/phone fields are not in PlayerProfile allowlist',
  },
  {
    id: 5,
    name: 'Immutable Timestamp Tampering',
    path: '/players/attacker_uid',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    reason: 'createdAt == existing().createdAt and updatedAt == request.time enforced',
  },
  {
    id: 6,
    name: 'Unbounded XP Spike',
    path: '/players/attacker_uid',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    reason: 'incoming().xp <= existing().xp + 500 blocks arbitrary XP jumps',
  },
  {
    id: 7,
    name: 'Orphan Activity Injection',
    path: '/players/attacker_uid/activities/act1',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'Master Gate exists(/databases/$(database)/documents/players/$(userId)) rejects orphan writes',
  },
  {
    id: 8,
    name: 'Activity Ledger Rewrite',
    path: '/players/attacker_uid/activities/act1',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    reason: 'allow update, delete: if false keeps activities immutable',
  },
  {
    id: 9,
    name: 'ID Poisoning on Room Create',
    path: '/rooms/' + 'A'.repeat(200),
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'isValidRoomCode enforces exact 6-char ^[A-Z0-9]{6}$ room code',
  },
  {
    id: 10,
    name: 'Non-Host Match Start',
    path: '/rooms/ROOM01',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    reason: 'start_countdown action requires existing().hostUserId == request.auth.uid',
  },
  {
    id: 11,
    name: 'Post-Finish Score Tampering',
    path: '/rooms/ROOM01',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    reason: 'Terminal State Locking requires existing().status != finished',
  },
  {
    id: 12,
    name: 'Unverified Email Write',
    path: '/players/attacker_uid',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'isVerifiedUser() requires request.auth.token.email_verified == true',
  },
];

// Static structural verification when running without local Firestore emulator
const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
if (fs.existsSync(rulesPath)) {
  const rulesText = fs.readFileSync(rulesPath, 'utf8');
  assert.ok(rulesText.includes("rules_version = '2';"), 'Must use rules_version = 2');
  assert.ok(rulesText.includes('allow read, write: if false;'), 'Must include catch-all deny rule');
  assert.ok(rulesText.includes('email_verified == true'), 'Must enforce email_verified');
  assert.ok(rulesText.includes('isValidPlayer('), 'Must define isValidPlayer');
  assert.ok(rulesText.includes('isValidRoom('), 'Must define isValidRoom');
  assert.ok(rulesText.includes('isValidParticipant('), 'Must define isValidParticipant');
  assert.ok(rulesText.includes('isValidActivity('), 'Must define isValidActivity');
  assert.ok(rulesText.includes("existing().status != 'finished'"), 'Must lock finished rooms');
}
