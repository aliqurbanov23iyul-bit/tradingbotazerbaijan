CREATE TABLE IF NOT EXISTS registrations (
 telegram_id text PRIMARY KEY, username text, status text NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Verified','Rejected')),
 enabled boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), last_seen timestamptz,
 CHECK(NOT enabled OR status='Verified')
);
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS username text;
CREATE TABLE IF NOT EXISTS signals (
 id bigserial PRIMARY KEY, asset text NOT NULL, period integer NOT NULL CHECK(period>0),
 direction text NOT NULL CHECK(direction IN ('AL','SAT','GÖZLƏ')), model text NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('Pending','Win','Loss','Void')), at timestamptz NOT NULL DEFAULT now(),
 confidence numeric CHECK(confidence BETWEEN 0 AND 100)
);
ALTER TABLE signals ADD COLUMN IF NOT EXISTS confidence numeric;
CREATE TABLE IF NOT EXISTS commissions (
 id bigserial PRIMARY KEY, telegram_id text NOT NULL REFERENCES registrations, cents bigint NOT NULL CHECK(cents>0),
 reference text NOT NULL UNIQUE, at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS control_settings (key text PRIMARY KEY,value jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS control_logs (
 id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), service text NOT NULL,
 event text NOT NULL, severity text NOT NULL, message text NOT NULL, actor text
);
CREATE INDEX IF NOT EXISTS control_logs_at_idx ON control_logs(at DESC,id DESC);
CREATE TABLE IF NOT EXISTS control_attempts (bucket text PRIMARY KEY, attempts integer NOT NULL, until_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS control_sessions (id text PRIMARY KEY, expires_at timestamptz NOT NULL);
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS first_name text;
CREATE TABLE IF NOT EXISTS affiliate_verifications (
 id bigserial PRIMARY KEY, telegram_id text NOT NULL REFERENCES registrations,
 status text NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Verified','Rejected')),
 requested_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz, reviewed_by text
);
CREATE UNIQUE INDEX IF NOT EXISTS affiliate_one_pending ON affiliate_verifications(telegram_id) WHERE status='Pending';
CREATE INDEX IF NOT EXISTS affiliate_request_history ON affiliate_verifications(telegram_id,requested_at DESC);
CREATE TABLE IF NOT EXISTS user_preferences (
 telegram_id text PRIMARY KEY REFERENCES registrations, selected_asset text CHECK(selected_asset IN ('XAU/USD','EUR/USD','GBP/USD','BTC/USD')),
 selected_duration integer CHECK(selected_duration IN (3,5,10,15,30,60,180,300,900))
);
CREATE TABLE IF NOT EXISTS bot_runtime (id integer PRIMARY KEY CHECK(id=1),username text,last_heartbeat timestamptz);
CREATE TABLE IF NOT EXISTS bot_callback_limits (telegram_id text PRIMARY KEY,next_at timestamptz);
CREATE TABLE IF NOT EXISTS market_providers (
 provider text PRIMARY KEY, enabled boolean NOT NULL DEFAULT false,
 transport text, cadence text, candle_basis text
);
INSERT INTO market_providers(provider) VALUES ('coinbase'),('oanda') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS market_assets (
 provider text REFERENCES market_providers, symbol text, enabled boolean NOT NULL DEFAULT false,
 stale_seconds integer NOT NULL DEFAULT 60 CHECK(stale_seconds>0),
 PRIMARY KEY(provider,symbol)
);
INSERT INTO market_assets(provider,symbol) VALUES
 ('coinbase','BTC/USD'),('oanda','XAU/USD'),('oanda','EUR/USD'),('oanda','GBP/USD') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS market_ticks (
 provider text,symbol text,event_at timestamptz,bid numeric(28,12),ask numeric(28,12),received_at timestamptz NOT NULL,
 PRIMARY KEY(provider,symbol,event_at,bid,ask), FOREIGN KEY(provider,symbol) REFERENCES market_assets,
 CHECK(bid>0 AND ask>=bid)
);
CREATE TABLE IF NOT EXISTS market_candles (
 provider text,symbol text,interval_seconds integer,open_at timestamptz,
 open numeric(28,12) NOT NULL,high numeric(28,12) NOT NULL,low numeric(28,12) NOT NULL,close numeric(28,12) NOT NULL,
 PRIMARY KEY(provider,symbol,interval_seconds,open_at), FOREIGN KEY(provider,symbol) REFERENCES market_assets,
 CHECK(interval_seconds IN (60,300,900,3600)),
 CHECK(low>0 AND low<=least(open,close) AND high>=greatest(open,close))
);
CREATE TABLE IF NOT EXISTS market_data_health (
 provider text PRIMARY KEY REFERENCES market_providers, status text NOT NULL, checked_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS market_data_errors (
 id bigserial PRIMARY KEY,provider text NOT NULL REFERENCES market_providers,
 scope text NOT NULL,code text NOT NULL,at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS market_errors_recent ON market_data_errors(at DESC,id DESC);
CREATE INDEX IF NOT EXISTS market_ticks_received ON market_ticks(received_at);
CREATE TABLE IF NOT EXISTS market_candle_quality (
 provider text,symbol text,interval_seconds integer,gaps integer NOT NULL,duplicates integer NOT NULL,checked_at timestamptz NOT NULL,
 PRIMARY KEY(provider,symbol,interval_seconds), FOREIGN KEY(provider,symbol) REFERENCES market_assets
);
CREATE OR REPLACE VIEW market_latest AS
SELECT a.provider,a.symbol,p.candle_basis,p.transport,p.cadence,
 t.event_at,t.received_at,t.bid,t.ask,h.checked_at,
 CASE WHEN t.event_at IS NOT NULL THEN round(greatest(0,extract(epoch FROM t.received_at-t.event_at)*1000)) END AS latency_ms,
 CASE
   WHEN NOT a.enabled OR NOT p.enabled THEN 'Not Configured'
   WHEN h.status IS DISTINCT FROM 'online' OR h.checked_at<now()-interval '20 seconds' THEN 'Offline'
   WHEN t.event_at IS NULL THEN 'No Quotes'
   WHEN t.event_at<now()-a.stale_seconds*interval '1 second' THEN 'Stale'
   ELSE 'Online'
 END AS status
FROM market_assets a JOIN market_providers p USING(provider)
LEFT JOIN market_data_health h USING(provider)
LEFT JOIN LATERAL (
 SELECT event_at,received_at,bid,ask FROM market_ticks
 WHERE provider=a.provider AND symbol=a.symbol ORDER BY event_at DESC,received_at DESC LIMIT 1
) t ON true;
