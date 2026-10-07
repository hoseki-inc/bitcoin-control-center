-- Migration 015 from main at 3be3a0f, applied after the frozen legacy-main.sql fixture.
-- Keep its original DDL independent of Drizzle's generated SQL. All data is synthetic.
CREATE TABLE desktop_connection_profiles (
  id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535),
  protocol TEXT NOT NULL CHECK(protocol IN ('tcp', 'ssl')),
  tor_enabled INTEGER NOT NULL CHECK(tor_enabled IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 1
);
INSERT INTO desktop_connection_profiles VALUES ('profile', 'Synthetic node', 'synthetic.onion', 50001, 'tcp', 1, 3);
INSERT INTO settings (key, value) VALUES ('desktop_active_connection', 'profile');
INSERT INTO _migrations (id, name, applied_at) VALUES (15, '015_desktop_connection_profiles', '2026-10-01 00:00:00');
