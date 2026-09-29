-- Compatibility migration for existing Sentinel databases.
-- Keystores linked to an account (wallet info for signing)
      CREATE TABLE keystores (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        wallet TEXT,
        model TEXT,
        derivation_path TEXT,
        xpub TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
--> statement-breakpoint
-- Challenges for proving ownership of an account
      CREATE TABLE challenges (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        is_satisfied INTEGER NOT NULL DEFAULT 0,
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
--> statement-breakpoint
-- Signed messages (challenge messages to be signed by the hardware wallet)
      CREATE TABLE signed_messages (
        id TEXT PRIMARY KEY,
        challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
        keystore_id TEXT NOT NULL REFERENCES keystores(id) ON DELETE CASCADE,
        address TEXT NOT NULL,
        message_text TEXT NOT NULL,
        signature TEXT,
        signed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
--> statement-breakpoint
-- Track verification status on accounts
      ALTER TABLE accounts ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
