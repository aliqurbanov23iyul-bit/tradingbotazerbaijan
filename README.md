# Quick Trade AI Control Center

The entry point is /dashboard. The server redirects unauthenticated visitors to /login. PostgreSQL stores users, signals, confirmed commissions, configuration and audit events. A local run without PostgreSQL uses temporary sessions and shows empty data. Production requires PostgreSQL.

## Local setup

1. Install Node.js 22 or later and run npm install for PostgreSQL support.
2. Copy .env.example to .env. Choose an admin username and a unique password of at least 14 characters. Pass the password through standard input to node scripts/hash.mjs and copy only its output to ADMIN_PASSWORD_HASH. Generate a random session key with node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))" and set SESSION_SECRET.
3. To enable persistent data and admin writes, set DATABASE_URL and run node --env-file=.env scripts/setup.mjs. Use a pooled TLS PostgreSQL connection on Vercel.
4. Run npm start and open http://127.0.0.1:3100/dashboard. Set PORT to an available port if needed.

The default username in the example is a placeholder. The repository has no default password. The local session expires after one hour and is cleared on server restart when no database is configured. Logging out revokes the current server session.

## Vercel

Import the control-center directory as an Other project. Leave the build command empty and use the checked-in vercel.json. Set DATABASE_URL, SESSION_SECRET, ADMIN_USERNAME and ADMIN_PASSWORD_HASH as server environment variables. Apply the schema before deployment. After deployment verify login, logout, dashboard loading and a manual affiliate update against the target database.

If you reuse an earlier database, the schema preserves existing registration, signal and commission rows and adds missing columns. Control Center settings and audit events use their own tables. Copy previous affiliate and Telegram settings deliberately after verifying their values. Never copy provider credentials to public files.

## Integration boundaries

The Telegram page includes a menu preview and live worker status. The hosting service controls the worker process. AI, market data and uptime display an explicit unconfigured state. Commissions come from the PostgreSQL commission ledger, which an authorized importer must populate from confirmed partner records. Before publishing any future referral link to Telegram users, show the stored disclosure and the actual commission model alongside it. The affiliate workflow requires manual approval and a separate access flag.

## Phase 2 · Telegram worker

The Control Center and the Python worker read and write the same PostgreSQL database. The Node API remains responsible for authenticated admin changes. The worker is the only process that receives Telegram updates.

### BotFather and local startup

1. Open [@BotFather](https://t.me/BotFather), send /newbot, choose a name and username, and copy the token into the worker's environment. For an existing bot, first check that its webhook has been removed. The worker refuses to start while a webhook is registered.
2. Install Python 3.11+ and run python -m pip install -r bot/requirements.txt in a virtual environment. Install the Node dependencies with npm install.
3. Configure the admin .env as described above. Apply the additive migration using node --env-file=.env scripts/setup.mjs before starting either service. Existing registrations and preferences are preserved.
4. Set the worker's DATABASE_URL and TELEGRAM_BOT_TOKEN privately. To load values from the local .env without putting secrets in command arguments, run node --env-file=.env scripts/start-bot.mjs. The launcher invokes python on PATH. BOT_SUPPORT_TEXT is optional. Keep the .env out of Git and remove the token from the local file if the worker uses a separate secret store.
5. In a separate terminal run npm start. Sign in to the Control Center and set the affiliate URL, commission model and user disclosure. Review requests in Affiliate → Verification Requests. To grant signal access, set Verified and Active together.

| Variable | Service | Purpose |
| --- | --- | --- |
| DATABASE_URL | Admin and worker | Same PostgreSQL database. Use a direct or session-pooled endpoint for the worker's singleton lock. |
| TELEGRAM_BOT_TOKEN | Worker only | BotFather token. |
| BOT_SUPPORT_TEXT | Worker only, optional | Azerbaijani support message or contact. |
| ADMIN_USERNAME, ADMIN_PASSWORD_HASH, SESSION_SECRET | Admin only | Existing administrator and session configuration. |
| PORT | Local admin, optional | Defaults to 3100. |

### Hosting

Deploy the Node admin on Vercel and run one persistent Python worker on a separate service that supports long-running processes. Configure PostgreSQL TLS according to the provider. For providers with separate direct and pooled endpoints, both URLs must refer to the same database. Long polling uses outbound Telegram requests and does not register or expose a webhook. If the transport is later switched to webhook, implement Telegram's secret-token header verification before accepting updates.

Bot status is based on a Telegram getMe heartbeat, expires after 60 seconds, and is cleared on normal shutdown. Maintenance mode pauses bot menu operations while the worker remains connected. Process lifecycle belongs to the worker host.

### Phase 2 acceptance checks

- Send /start from a private Telegram chat and check Users for the ID, username and last activity.
- Set an affiliate URL and disclosure, open Qeydiyyat, request verification twice and confirm that only one pending entry exists.
- Review the request in the panel. Check Hesabım and Siqnal Al before approval, after Verified + Active, and after suspension.
- Select an asset and duration, restart the bot and confirm preferences persist. Disable the duration in the panel and confirm a stale callback cannot use it.
- Verify Analiz et returns the preparation message without inserting a signal. Turn maintenance on and off, and confirm the status changes after the worker stops.
- Run node scripts/smoke.mjs to check the admin routes without PostgreSQL.

Phase 3 can consume registrations.status/enabled, user_preferences and the enabled duration list. The existing signals table and admin analytics can display recorded outcomes. Add a provider and analysis service behind the analyze handler and enforce current permissions at signal generation time.

## Phase 3 · Market Data Engine

Apply the additive schema before restarting the admin or bot. Install the Python
dependencies in a virtual environment with python -m pip install -r market/requirements.txt.
Run the worker from the project directory with python -m market.worker. Supply these
variables through the worker host's secret/environment configuration:

| Variable | Value |
| --- | --- |
| DATABASE_URL | Same PostgreSQL database as the admin and Telegram bot. Use a direct or session-pooled connection for the singleton lock. |
| MARKET_COINBASE_ENABLED | Set to 1 to enable the public Coinbase Exchange BTC/USD feed. |
| OANDA_TOKEN | OANDA v20 access token. |
| OANDA_ACCOUNT_ID | OANDA v20 account ID. |
| OANDA_ENV | practice by default, or live. |
| OANDA_SYMBOLS | Comma-separated available symbols. Defaults to XAU/USD,EUR/USD,GBP/USD. |

Use a persistent host for the market worker. Keep the admin on Vercel and the Telegram
worker on its existing host. Enable only feeds and instruments your account can access.
Provider secrets belong to the market worker, outside the Vercel frontend and Telegram worker.

Coinbase uses its public WebSocket ticker and REST trade candles. OANDA uses its
account pricing HTTP stream and REST midpoint candles. The collector starts with up to
200 recent candles per interval, refreshes overlapping windows to catch gaps, and
retains older completed candles already stored. Long interruptions beyond that rolling
window require a separate backfill. Closed markets and no-trade buckets can appear as
gaps. The worker preserves UTC event time and receipt time and marks prices older
than 60 seconds stale. The panel refreshes about every 10 seconds while visible and
does not overwrite focused controls. Twelve Data is a candidate for a future adapter.
OTC has no enabled provider.

For a future analysis service, read market_latest for validated availability and
market_candles for ascending UTC OHLC records keyed by provider, symbol, interval
and open time. Keep trade-based and midpoint series separate. Prices reflect their
named sources. Recheck availability before using a quote.

Verification commands:
- node scripts/market-smoke.mjs
- node scripts/smoke.mjs
- python -m unittest market.test_market
- For persistence coverage, set MARKET_TEST_DATABASE_URL to a separate migrated test
  database before running the Python suite. Fixture writes are rolled back.
- For live acceptance, enable Coinbase and verify BTC/USD shows fresh bid/ask,
  completed candles and source metadata. Stop the worker and verify the quote is
  no longer Online within 20 seconds. Verify Telegram reports unavailability for
  the affected asset and recovers when the stream is back.

Provider references:
- https://developer.oanda.com/rest-live-v20/pricing-ep/
- https://docs.cdp.coinbase.com/exchange/websocket-feed/channels
- https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles

## Phase 4A · PostgreSQL activation

Keep DATABASE_URL private. Add it to the existing .env for local use, or to
the server-side environment for Vercel. Use a PostgreSQL URL containing the
database name. Remote connections always verify TLS certificates. Only
non-production localhost may use sslmode=disable. For a private certificate
authority, configure the process trust store with NODE_EXTRA_CA_CERTS rather
than disabling certificate validation. Supported URL options are sslmode
and application_name.

Use Node 22. Install locked dependencies with npm ci. With a database role
that can create and alter the application schema, run:

    node --env-file=.env scripts/setup.mjs

The setup applies the base schema and migration 004a in one transaction,
records the version and can be rerun. Use a direct database endpoint for
schema setup if your provider exposes a separate pooler. Use a suitably
restricted runtime database role after applying the migration.

Restart the admin process so it reads the changed environment. GET
/api/control?action=health returns HTTP 200 only when PostgreSQL responds
and migration 004a is recorded. HTTP 503 means unconfigured, unavailable
or migration required. No URL, database identity or raw database error is
included. Local login without DATABASE_URL is for UI inspection only.
Database-dependent edits return HTTP 503 in this mode.

Checks:

    node --test
    node scripts/smoke.mjs
    node scripts/market-smoke.mjs

Environment files are excluded by .gitignore except for .env.example.
Inspect the staged file list before the first commit, particularly if any
environment file was previously tracked.
