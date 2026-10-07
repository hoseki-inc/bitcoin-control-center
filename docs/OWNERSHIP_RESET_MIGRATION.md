# Unfinished ownership proofs: migration 017

`017_reset_unfinished_challenge_messages` is a one-time pre-release reset for
issue #236. It removes all messages (including valid partial signatures) only
when their challenge has `is_satisfied = 0 AND completed_at IS NULL`. Either
completion marker protects a challenge's messages. Challenges, account status,
keystore metadata, and completed proofs are retained. Users with unfinished
verification reconnect their devices and sign fresh messages.

The migration is a single SQLite `DELETE`, with no schema changes, application
callbacks, foreign-key toggles, or dependence on cascading deletes. The existing
runner commits the delete and journal entry together; failure rolls both back.
It must run once per profile, not at every startup: replaying it after users resume
signing would erase their new progress.

## Porting to Drizzle (PR #191)

1. Add a custom data migration after the existing migrations, with the exact SQL
   from `apps/api-sentinel/src/db.ts` and a descriptive
   `reset_unfinished_challenge_messages` suffix. Follow that branch's custom
   migration/snapshot format; the schema is unchanged.
2. In `src/db/migration-journal.ts`, map the legacy name
   `017_reset_unfinished_challenge_messages` to the new Drizzle migration in
   `optionalMigrations`, just like the desktop connection and quote migrations.
   Validate that the migration file exists. Do not append it to the original
   fourteen-entry `legacyNames` array.
3. Preserve an already-applied legacy entry's ID and application time during
   journal adoption. Translate it to the corresponding Drizzle name/hash/time;
   **do not execute the delete again**. This also prevents the existing strict
   journal validation from rejecting upgraded main profiles as unknown history.
4. Test both paths: a legacy profile without 017 runs the reset once; a profile
   with 017 and newly saved signatures adopts its journal without resetting
   those signatures. Also test fresh databases and existing Drizzle profiles:
   each should apply the new migration once through the native migrator.
5. Carry over the read-only getter changes and missing-message UI routing. Keep
   signing-identity checks in message creation, signature submission, and final
   completion. Adapt `db.test.ts` and the ownership regression to the async client.

The SQL is portable unchanged. The journal mapping is essential for compatibility;
an older Drizzle build that does not recognize 017 will reject such profiles.
