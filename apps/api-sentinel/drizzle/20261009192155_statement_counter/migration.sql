CREATE TABLE `statement_counter` (
	`id` integer PRIMARY KEY,
	`last_counter` integer NOT NULL,
	CONSTRAINT "statement_counter_single_row_check" CHECK("id" = 1)
);
--> statement-breakpoint
-- Start from the highest existing number so upgraded installs never reuse one.
INSERT INTO `statement_counter` (`id`, `last_counter`)
SELECT 1, COALESCE(MAX(`counter`), 0) FROM `statements`;
