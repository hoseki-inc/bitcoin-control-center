-- One-time pre-release reset: unfinished proofs must be signed again using
-- current signing addresses. Keep challenges so existing flows can resume.
-- Preserve either completion marker, including inconsistent historical rows.
DELETE FROM `signed_messages`
WHERE `challenge_id` IN (
  SELECT `id` FROM `challenges`
  WHERE `is_satisfied` = 0 AND `completed_at` IS NULL
);
