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

## 2. Additional Invariants
7. **Owner-Only Full App Backup**: `/players/{userId}/backup/snapshot` stores parsed maps/arrays for focus logs, question stats, mocks, tests, planner, books, and settings and is strictly readable and writable only by `isOwner(userId)` with parent `/players/{userId}` existing.
8. **Bounded One-Time Guest Import**: A newly signed-in player with zero stats (`xp == 0 && questionsSolved == 0 && focusMinutes == 0 && mockTestsCount == 0`) may import pre-login guest totals within bounded limits once; all subsequent updates remain capped at `+500 XP` per transaction.
