CREATE TABLE `desktop_connection_profiles` (
	`id` text PRIMARY KEY,
	`nickname` text NOT NULL,
	`host` text NOT NULL,
	`port` integer NOT NULL,
	`protocol` text NOT NULL,
	`tor_enabled` integer NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "desktop_connection_profiles_port_check" CHECK("port" BETWEEN 1 AND 65535),
	CONSTRAINT "desktop_connection_profiles_protocol_check" CHECK("protocol" IN ('tcp', 'ssl')),
	CONSTRAINT "desktop_connection_profiles_tor_enabled_check" CHECK("tor_enabled" IN (0, 1))
);
