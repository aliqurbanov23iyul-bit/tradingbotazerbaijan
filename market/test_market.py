import asyncio
import os
import unittest
from datetime import datetime, timezone

from .model import candle, missing_buckets, quote
from .providers import Coinbase, FeedError, check_http

NOW = datetime(2026, 1, 1, 0, 5, tzinfo=timezone.utc)


class Validation(unittest.TestCase):
    def test_quote_rejects_bad_prices_and_future_time(self):
        valid = quote("BTC/USD","2026-01-01T00:05:00Z","100","101",NOW)
        self.assertEqual(valid[2],100)
        for at,bid,ask in [
            ("2026-01-01T00:06:00Z",100,101),
            ("2026-01-01T00:05:00Z",102,101),
            ("2026-01-01T00:05:00Z","NaN",101),
            ("2026-01-01T00:05:00",100,101),
        ]:
            with self.assertRaises(ValueError):
                quote("BTC/USD",at,bid,ask,NOW)

    def test_closed_candles_and_missing_buckets(self):
        first = candle("2026-01-01T00:00:00Z",60,100,104,99,103,NOW)
        third = candle("2026-01-01T00:02:00Z",60,103,104,100,101,NOW)
        self.assertEqual(missing_buckets([third,first,first],60),1)
        with self.assertRaises(ValueError):
            candle("2026-01-01T00:05:00Z",60,100,104,99,103,NOW)

    def test_rate_limit_honors_retry_after(self):
        response = type("Response",(),{"status":429,"headers":{"Retry-After":"90"}})()
        with self.assertRaises(FeedError) as error:
            check_http(response)
        self.assertEqual(error.exception.retry,90)


class SocketFixture:
    def __init__(self):
        self.messages = iter([
            {"type":"heartbeat","product_id":"BTC-USD"},
            {"type":"ticker","product_id":"BTC-USD","time":"2026-01-01T00:05:00Z",
             "best_bid":"100","best_ask":"101"},
        ])
        self.closed = False

    async def __aenter__(self):
        return self

    async def __aexit__(self,*args):
        self.closed = True

    async def send_json(self,message):
        self.subscription = message

    async def receive_json(self,timeout):
        return next(self.messages)


class ProviderFixture(unittest.IsolatedAsyncioTestCase):
    async def test_subscription_parsing_and_disconnect(self):
        socket = SocketFixture()
        http = type("HTTP",(),{"ws_connect":lambda self,*a,**k:socket})()
        feed = Coinbase().stream(http)
        self.assertIsNone(await anext(feed))
        self.assertEqual((await anext(feed))[2:],("100","101"))
        await feed.aclose()
        self.assertTrue(socket.closed)
        self.assertEqual(socket.subscription["product_ids"],["BTC-USD"])


@unittest.skipUnless(os.getenv("MARKET_TEST_DATABASE_URL"),"requires migrated test PostgreSQL")
class Persistence(unittest.IsolatedAsyncioTestCase):
    async def test_duplicate_and_stale_availability(self):
        import asyncpg
        from .worker import health,save_tick,save_candles

        db = await asyncpg.connect(os.environ["MARKET_TEST_DATABASE_URL"])
        transaction = db.transaction()
        await transaction.start()
        try:
            await db.execute("UPDATE market_providers SET enabled=true WHERE provider='coinbase'")
            await db.execute("UPDATE market_assets SET enabled=true WHERE provider='coinbase'")
            await db.execute("DELETE FROM market_ticks WHERE provider='coinbase'")
            await health(db,"coinbase","online")
            now = await db.fetchval("SELECT now()")
            sample = quote("BTC/USD",now.isoformat(),100,101,now)
            self.assertEqual(await save_tick(db,"coinbase",sample),"INSERT 0 1")
            self.assertEqual(await save_tick(db,"coinbase",sample),"INSERT 0 0")
            self.assertEqual(await db.fetchval("SELECT status FROM market_latest WHERE symbol='BTC/USD'"),"Online")
            await db.execute("UPDATE market_ticks SET event_at=now()-interval '5 minutes' WHERE provider='coinbase'")
            self.assertEqual(await db.fetchval("SELECT status FROM market_latest WHERE symbol='BTC/USD'"),"Stale")
            bars = [candle("2026-01-01T00:00:00Z",60,100,104,99,103,NOW)]
            await db.execute("DELETE FROM market_candles WHERE provider='coinbase'")
            await save_candles(db,"coinbase","BTC/USD",60,bars)
            await save_candles(db,"coinbase","BTC/USD",60,bars)
            self.assertEqual(await db.fetchval("SELECT count(*) FROM market_candles WHERE provider='coinbase'"),1)
        finally:
            await transaction.rollback()
            await db.close()


class Reconnection(unittest.IsolatedAsyncioTestCase):
    async def test_retries_and_recovers_with_fixture(self):
        try:
            from .worker import stream
        except ModuleNotFoundError as exc:
            self.skipTest(str(exc))
        states, waits = [], []

        class DB:
            async def execute(self, sql, *args):
                if "market_data_health" in sql:
                    states.append(args[1])

        class Fixture:
            key, attempts = "coinbase", 0

            async def stream(self,http):
                self.attempts += 1
                if self.attempts == 1:
                    raise FeedError("HTTP_429",45)
                yield None
                raise asyncio.CancelledError

        async def sleep(seconds):
            waits.append(seconds)

        with self.assertRaises(asyncio.CancelledError):
            await stream(DB(),None,Fixture(),sleep)
        self.assertEqual(states,["connecting","offline","connecting","online"])
        self.assertEqual(waits,[45])
