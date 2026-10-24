CREATE TABLE `profiles` (
	`id` text PRIMARY KEY,
	`role` text NOT NULL,
	`pin_hash` text,
	`pin_set_at` integer,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	CONSTRAINT "profiles_role_check" CHECK("role" IN ('owner'))
);
--> statement-breakpoint
-- The owner exists from the start; a PIN is set later, in the app or by the platform.
INSERT INTO `profiles` (`id`, `role`) VALUES ('owner', 'owner');
