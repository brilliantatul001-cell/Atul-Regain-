# Security Specification — Leave It Arena (Firestore)

## 1. Data Invariants
1. **No PII in Public Profiles**: `/players/{userId}` contains only competitive handles, display names, XP, focus minutes, streak counters, and duel tallies. Email addresses and OAuth identifiers never leave Firebase Auth.
2. **Zero-Stat Profile Creation & Bounded Progression**: Newly created `/players/{userId}` documents must initialize `xp`, `focusMinutes`, `questionsSolved`, `duelWins`, and `duelPlayed` to `0`, and `uid` must equal `request.auth.uid`. Updates cannot forge negative values, retroactively alter `createdAt`, or jump XP by more than 500 per transaction.
3. **Immutable Activity Ledger**: `/players/{userId}/activities/{activityId}` can only be created by `request.auth.uid` if the parent `/players/{userId}` document exists, with server-enforced `createdAt == request.time`, strict enum `kind`, and no updates or deletes.
4. **Atomic Room Creation & Bounded Participants**: Creating `/rooms/{roomCode}` requires a 6-character uppercase alphanumeric ID, `hostUserId == request.auth.uid`, `status == 'lobby'`, `participantIds` containing only `[request.auth.uid]`, and an atomic `/rooms/{roomCode}/participants/{uid}` document verified via `existsAfter()`.
5. **Terminal State Locking**: Once `/rooms/{roomCode}` reaches `status == 'finished'`, neither room metadata nor participant scores may be modified.
6. **Verified Identity & Strict Field Allowlists**: Every write requires `request.auth != null && request.auth.token.email_verified == true`, strict `keys().hasAll(...)` + `keys().hasOnly(...)` on create, and action-scoped `affectedKeys().hasOnly(...)` on update.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Identity Spoofing on Player Create**: Creating `/players/victim_uid` while signed in as `attacker_uid` -> `PERMISSION_DENIED`.
2. **Initial XP Forgery**: Creating `/players/attacker_uid` with `xp: 999999` -> `PERMISSION_DENIED`.
3. **Shadow Field Injection on Player Update**: Updating `/players/attacker_uid` with an unallowed ghost field `isAdmin: true` -> `PERMISSION_DENIED`.
4. **PII Leak Attempt**: Writing an `email` field onto `/players/attacker_uid` -> `PERMISSION_DENIED`.
5. **Immutable Timestamp Tampering**: Updating `/players/attacker_uid` with a forged `createdAt` or client-supplied `updatedAt != request.time` -> `PERMISSION_DENIED`.
6. **Unbounded XP Spike**: Updating `/players/attacker_uid` with `xp: existing.xp + 50000` -> `PERMISSION_DENIED`.
7. **Orphan Activity Injection**: Creating `/players/attacker_uid/activities/act1` before `/players/attacker_uid` exists -> `PERMISSION_DENIED`.
8. **Activity Ledger Rewrite**: Updating or deleting an existing `/players/attacker_uid/activities/act1` -> `PERMISSION_DENIED`.
9. **ID Poisoning on Room Create**: Creating `/rooms/` with a 500-char junk room ID -> `PERMISSION_DENIED`.
10. **Non-Host Match Start**: Attempting `status: 'lobby' -> 'countdown'` on `/rooms/ROOM01` by a non-host participant -> `PERMISSION_DENIED`.
11. **Post-Finish Score Tampering**: Updating `winnerUserId` or `sprintScore` after `/rooms/ROOM01` has `status: 'finished'` -> `PERMISSION_DENIED`.
12. **Unverified Email Write**: Performing any write when `request.auth.token.email_verified == false` -> `PERMISSION_DENIED`.
13. **Cross-User Private Backup Read**: Attempting to read `/players/victim_uid/backup/snapshot` while signed in as `attacker_uid` -> `PERMISSION_DENIED`.
14. **Repeat Guest Bulk Stat Injection**: Attempting to use the one-time guest summary migration path after `existing.xp > 0` or `existing.questionsSolved > 0` -> `PERMISSION_DENIED`.
15. **Self-Accepted Friend Request Forgery**: Creating `/friendships/a_b` with `status: 'accepted'` directly as `requesterUid` or accepting someone else's pending request -> `PERMISSION_DENIED`.
16. **Cross-User Friend Graph Scraping**: Listing `/friendships` or `/friendInvites` without scoping to `request.auth.uid` -> `PERMISSION_DENIED`.
17. **Post-Finish Room Chat Injection**: Creating a message in `/rooms/ROOM01/messages/{msgId}` after `rooms/ROOM01.status == 'finished'` or by a non-participant -> `PERMISSION_DENIED`.
18. **Spoofed Room Message Sender**: Creating a `/rooms/ROOM01/messages/{msgId}` with `senderUid != request.auth.uid` -> `PERMISSION_DENIED`.

## 3. Additional Invariants
7. **Owner-Only Full App Backup**: `/players/{userId}/backup/snapshot` stores parsed maps/arrays for focus logs, question stats, mocks, tests, planner, books, and settings and is strictly readable and writable only by `isOwner(userId)` with parent `/players/{userId}` existing.
8. **Bounded One-Time Guest Import**: A newly signed-in player with zero stats (`xp == 0 && questionsSolved == 0 && focusMinutes == 0 && mockTestsCount == 0`) may import pre-login guest totals within bounded limits once; all subsequent updates remain capped at `+500 XP` per transaction.
9. **Deduplicated Planner Task Rewards & Live Room Task Competition**: Completing a daily planner task records an immutable `task_completed` activity document keyed deterministically per task/day so re-toggling cannot farm XP, and increments optional `tasksCompleted` counters on the player and active room participant within strict size and numeric bounds.
10. **Canonical Two-Sided Friendships**: `/friendships/{pairId}` enforces canonical sorted `pairId = users[0] + '_' + users[1]`, creation only as `'pending'` by `requesterUid == request.auth.uid` with verified player docs for both users, acceptance (`pending -> accepted`) strictly by `recipientUid == request.auth.uid`, and deletion by either member.
11. **Scoped Room Invites**: `/friendInvites/{inviteId}` may only be created by an active room participant for a non-finished room, read/listed strictly by `fromUid` or `toUid`, and deleted by either party.
12. **Ephemeral Room Chat & Auto-Vanish**: `/rooms/{roomCode}/messages/{messageId}` can only be created while parent `/rooms/{roomCode}` exists and `status != 'finished'`, only by current room participants (`request.auth.uid in room.participantIds`), with `allowedUids` strictly matching room participants (`list` gated on `request.auth.uid in resource.data.allowedUids`), immutable updates (`false`), and deletion permitted for sender or room participants so all messages are purged from Firestore immediately when a session finishes.
13. **Bounded Study Profile & Avatar Customization**: `/players/{userId}` optionally accepts strictly bounded, zero-PII study preferences (`examTarget`, `targetYear`, `batch`, `goal`, `dailyGoalMin`, `studySlot`, `strongSubject`, `weakSubject`, `studyStyle`, `statusBadge`, `bio`, `avatarPreset`) and compressed avatar image data URLs (`<= 28,000` bytes matching `^data:image/(jpeg|png|webp);base64,...`) modifiable only by `isOwner(userId)` without altering competitive stats.
