import asyncio
import logging
import os
import random
import time

import aiohttp
import asyncpg

from .model import INTERVALS, candle, missing_buckets, quote, utc_now
from .providers import Coinbase, FeedError, Oanda, check_http


async def error(db, key, scope, exc):
    code = exc.code if isinstance(exc, FeedError) else type(exc).__name__
    logging.warning("%s %s %s", key, scope, code)
    await db.execute(
        "INSERT INTO market_data_errors(provider,scope,code) VALUES($1,$2,$3)", key,scope,code
    )


async def health(db, key, state):
    await db.execute(
        """INSERT INTO market_data_health(provider,status,checked_at) VALUES($1,$2,now())
        ON CONFLICT(provider) DO UPDATE SET status=excluded.status,checked_at=excluded.checked_at""",
        key,state
    )


async def save_tick(db, provider, tick):
    return await db.execute(
        """INSERT INTO market_ticks(provider,symbol,event_at,bid,ask,received_at)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING""", provider,*tick
    )


async def save_candles(db, provider, symbol, interval, rows):
    if rows:
        await db.executemany(
            """INSERT INTO market_candles(provider,symbol,interval_seconds,open_at,open,high,low,close)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING""",
            [(provider,symbol,interval,*row) for row in rows]
        )


async def stream(db, http, provider, sleep=asyncio.sleep):
    delay = 1
    while True:
        try:
            await health(db,provider.key,"connecting")
            last_health = None
            async for message in provider.stream(http):
                now = utc_now()
                if message is not None:
                    try:
                        tick = quote(*message, now)
                        if tick[0] not in provider.symbols:
                            raise ValueError("unexpected symbol")
                    except (ValueError, TypeError, AttributeError, OverflowError, ArithmeticError) as exc:
                        await error(db,provider.key,"quote.validation",exc)
                        continue
                    await save_tick(db,provider.key,tick)
                if last_health is None or time.monotonic()-last_health >= 5:
                    await health(db,provider.key,"online")
                    last_health = time.monotonic()
                delay = 1
            raise FeedError("STREAM_CLOSED")
        except (aiohttp.ClientError, TimeoutError, ValueError, TypeError, FeedError) as exc:
            await health(db,provider.key,"offline")
            await error(db,provider.key,"stream",exc)
            if isinstance(exc,aiohttp.WSServerHandshakeError):
                try:
                    check_http(exc)
                except FeedError as handshake:
                    exc = handshake
            await sleep(max(getattr(exc,"retry",0),delay + random.random()))
            delay = min(delay*2,60)


async def history(db, http, provider):
    while True:
        for symbol in provider.symbols:
            for interval in INTERVALS:
                wait = 1
                try:
                    raw = await provider.candles(http,symbol,interval,200)
                    now = utc_now()
                    rows = []
                    for at,o,h,l,c in raw:
                        try:
                            rows.append(candle(at,interval,o,h,l,c,now))
                        except (ValueError, TypeError, AttributeError, OverflowError, ArithmeticError) as exc:
                            # Coinbase includes the current open bucket.
                            if provider.key == "coinbase" and type(at) is int and int(now.timestamp()) // interval * interval == at:
                                continue
                            await error(db,provider.key,"candle.validation",exc)
                    await save_candles(db,provider.key,symbol,interval,rows)
                    await db.execute(
                        """INSERT INTO market_candle_quality VALUES($1,$2,$3,$4,$5,now())
                        ON CONFLICT(provider,symbol,interval_seconds) DO UPDATE SET gaps=excluded.gaps,
                        duplicates=excluded.duplicates,checked_at=excluded.checked_at""",
                        provider.key,symbol,interval,missing_buckets(rows,interval),
                        len(rows)-len({row[0] for row in rows})
                    )
                except (aiohttp.ClientError, TimeoutError, ValueError, TypeError, KeyError, FeedError) as exc:
                    await error(db,provider.key,"history",exc)
                    wait = max(5,getattr(exc,"retry",0))
                await asyncio.sleep(wait)
        await asyncio.sleep(60)


def configured_providers():
    providers = []
    if os.getenv("MARKET_COINBASE_ENABLED") == "1":
        providers.append(Coinbase())
    token, account = os.getenv("OANDA_TOKEN"), os.getenv("OANDA_ACCOUNT_ID")
    if bool(token) != bool(account):
        raise ValueError("OANDA requires both token and account ID")
    if token:
        symbols = tuple(dict.fromkeys(os.getenv("OANDA_SYMBOLS","XAU/USD,EUR/USD,GBP/USD").split(",")))
        providers.append(Oanda(token,account,os.getenv("OANDA_ENV","practice"),symbols))
    return providers


async def main():
    providers = configured_providers()
    if not providers:
        raise RuntimeError("No market providers enabled")
    async with asyncpg.create_pool(os.environ["DATABASE_URL"], min_size=1,max_size=6,
                                  command_timeout=15) as db, db.acquire() as lock:
        if not await lock.fetchval("SELECT pg_try_advisory_lock(912802, 2)"):
            raise RuntimeError("Another market worker is running")
        async with db.acquire() as conn, conn.transaction():
            await conn.execute("UPDATE market_providers SET enabled=false")
            await conn.execute("UPDATE market_assets SET enabled=false")
            for provider in providers:
                await conn.execute(
                    """UPDATE market_providers SET enabled=true,transport=$2,cadence=$3,candle_basis=$4
                    WHERE provider=$1""", provider.key,provider.transport,provider.cadence,provider.candle_basis
                )
                await conn.execute("UPDATE market_assets SET enabled=true WHERE provider=$1 AND symbol=ANY($2::text[])",
                                   provider.key,list(provider.symbols))
                await health(conn,provider.key,"connecting")
        timeout = aiohttp.ClientTimeout(total=None,connect=10,sock_read=25)
        try:
            async with aiohttp.ClientSession(timeout=timeout) as http, asyncio.TaskGroup() as group:
                for provider in providers:
                    group.create_task(stream(db,http,provider))
                    group.create_task(history(db,http,provider))
        finally:
            for provider in providers:
                await health(lock,provider.key,"offline")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
    except Exception as exc:
        logging.error("Market worker stopped: %s",type(exc).__name__)
        raise SystemExit(1) from None
