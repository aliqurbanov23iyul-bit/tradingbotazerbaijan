CREATE INDEX IF NOT EXISTS control_sessions_expiry_idx ON control_sessions(expires_at);
CREATE INDEX IF NOT EXISTS control_attempts_expiry_idx ON control_attempts(until_at);
CREATE INDEX IF NOT EXISTS registrations_created_idx ON registrations(created_at DESC,telegram_id);
CREATE INDEX IF NOT EXISTS affiliate_verifications_queue_idx ON affiliate_verifications(status,requested_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS signals_recent_idx ON signals(at DESC,id DESC);
