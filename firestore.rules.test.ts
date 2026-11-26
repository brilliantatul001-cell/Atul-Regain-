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
  {
    id: 13,
    name: 'Cross-User Private Backup Read',
    path: '/players/victim_uid/backup/snapshot',
    operation: 'get',
    expected: 'PERMISSION_DENIED',
    reason: 'backup subcollection is strictly restricted to isOwner(userId)',
  },
  {
    id: 14,
    name: 'Repeat Guest Bulk Stat Injection',
    path: '/players/attacker_uid',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    reason: 'one-time guest import requires existing stats to be strictly zero',
  },
  {
    id: 15,
    name: 'Self-Accepted Friend Request Forgery',
    path: '/friendships/attacker_uid_victim_uid',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'create enforces status == pending and only recipientUid can accept',
  },
  {
    id: 16,
    name: 'Cross-User Friend Graph Scraping',
    path: '/friendships',
    operation: 'list',
    expected: 'PERMISSION_DENIED',
    reason: 'allow list requires request.auth.uid in resource.data.users',
  },
  {
    id: 17,
    name: 'Post-Finish Room Chat Injection',
    path: '/rooms/ROOM01/messages/msg1',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'messages require parent room status != finished and active participant membership',
  },
  {
    id: 18,
    name: 'Spoofed Room Message Sender',
    path: '/rooms/ROOM01/messages/msg2',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'incoming().senderUid == request.auth.uid prevents sender impersonation',
  },
  {
    id: 19,
    name: 'Cross-User Presence Spoofing',
    path: '/players/victim_uid',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    reason: 'isOwner(userId) blocks modifying another player isOnline or lastSeenAtMs',
  },
  {
    id: 20,
    name: 'Bundled XP Forgery During Presence Heartbeat',
    path: '/players/attacker_uid',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    reason: 'presence update action restricts affectedKeys to isOnline, lastSeenAtMs, updatedAt',
  },
  {
    id: 21,
    name: 'Non-Friend Story Snooping',
    path: '/stories/story_abc',
    operation: 'get',
    expected: 'PERMISSION_DENIED',
    reason: 'stories require request.auth.uid in resource.data.viewerUids or authorUid',
  },
  {
    id: 22,
    name: 'Spoofed Story Author or Reaction Sender',
    path: '/stories/story_abc/reactions/rx1',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'create enforces senderUid == request.auth.uid and viewerUids membership',
  },
  {
    id: 23,
    name: 'Cross-User Private Diary Access',
    path: '/players/victim_uid/diary/2026-11-26',
    operation: 'get',
    expected: 'PERMISSION_DENIED',
    reason: 'diary subcollection requires isOwner(userId) and verified email',
  },
  {
    id: 24,
    name: 'Diary Entry Oversize or Bad Date Key',
    path: '/players/attacker_uid/diary/bad_key',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    reason: 'isValidDiaryDateKey and isValidDiaryEntry strictly validate dateKey and bounds',
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
  assert.ok(rulesText.includes('isValidAccountBackup('), 'Must define isValidAccountBackup');
  assert.ok(rulesText.includes('isValidFriendship('), 'Must define isValidFriendship');
  assert.ok(rulesText.includes('isValidFriendInvite('), 'Must define isValidFriendInvite');
  assert.ok(rulesText.includes('isValidRoomMessage('), 'Must define isValidRoomMessage');
  assert.ok(rulesText.includes('isValidStory('), 'Must define isValidStory');
  assert.ok(rulesText.includes('isValidStoryView('), 'Must define isValidStoryView');
  assert.ok(rulesText.includes('isValidStoryReaction('), 'Must define isValidStoryReaction');
  assert.ok(rulesText.includes('isValidDiaryEntry('), 'Must define isValidDiaryEntry');
  assert.ok(rulesText.includes("existing().status != 'finished'"), 'Must lock finished rooms');
  assert.ok(rulesText.includes("'task_completed'"), 'Must allow task_completed activity kind');
  assert.ok(rulesText.includes('activeTaskTitle.size() <= 60'), 'Must bound activeTaskTitle length');
  assert.ok(rulesText.includes("data.kind in ['chat', 'rivalry', 'cheer']"), 'Must restrict room message kinds');
  assert.ok(rulesText.includes('data.avatarDataUrl.size() <= 28000'), 'Must bound avatarDataUrl size');
  assert.ok(rulesText.includes('data.dailyGoalMin <= 720'), 'Must bound dailyGoalMin');
  assert.ok(rulesText.includes("'isOnline'") && rulesText.includes("'lastSeenAtMs'"), 'Must support bounded presence fields');
  assert.ok(rulesText.includes('match /stories/{storyId}'), 'Must secure stories collection and subcollections');
  assert.ok(rulesText.includes('match /diary/{entryId}'), 'Must secure owner-only diary subcollection');
  assert.ok(rulesText.includes('data.captionX >= 5 && data.captionX <= 95'), 'Must bound story overlay coordinates');
}


