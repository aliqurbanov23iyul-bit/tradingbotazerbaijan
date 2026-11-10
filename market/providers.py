import json
import re

from .model import SYMBOLS

OANDA_SYMBOLS = {symbol.replace("/", "_"): symbol for symbol in SYMBOLS[:3]}
GRANULARITY = {60:"M1", 300:"M5", 900:"M15", 3600:"H1"}


class FeedError(Exception):
    def __init__(self, code, retry=0):
        self.code = code
        self.retry = retry


def check_http(response):
    if response.status >= 300:
        retry = response.headers.get("Retry-After", "")
        raise FeedError(f"HTTP_{response.status}", int(retry) if retry.isdigit() else
                        (60 if response.status in (401, 403, 429) else 0))


class Coinbase:
    key, transport, symbols = "coinbase", "WebSocket", ("BTC/USD",)
    candle_basis = "trades"
    cadence = "Trade-driven ticker; 1s heartbeat"

    async def stream(self, http):
        async with http.ws_connect("wss://ws-feed.exchange.coinbase.com", heartbeat=10) as ws:
            await ws.send_json({"type":"subscribe","product_ids":["BTC-USD"],"channels":["ticker","heartbeat"]})
            while True:
                message = await ws.receive_json(timeout=20)
                if message.get("type") == "error":
                    raise FeedError("SUBSCRIPTION_REJECTED")
                if message.get("product_id") != "BTC-USD":
                    continue
                if message["type"] == "heartbeat":
                    yield None
                elif message["type"] == "ticker":
                    yield ("BTC/USD", message.get("time"), message.get("best_bid"), message.get("best_ask"))

    async def candles(self, http, symbol, interval, count):
        async with http.get("https://api.exchange.coinbase.com/products/BTC-USD/candles",
                            params={"granularity":interval}, allow_redirects=False) as response:
            check_http(response)
            rows = await response.json()
        return [(t,o,h,l,c) for t,l,h,o,c,_ in sorted(rows)[-count:]]


class Oanda:
    key, transport = "oanda", "HTTP stream"
    candle_basis = "midpoint"
    cadence = "Up to 4 quotes/s per instrument; 5s heartbeat"

    def __init__(self, token, account, environment, symbols):
        if not re.fullmatch(r"[A-Za-z0-9-]+", account) or environment not in {"practice","live"}:
            raise ValueError("invalid OANDA configuration")
        if not symbols or any(symbol not in SYMBOLS[:3] for symbol in symbols):
            raise ValueError("invalid OANDA symbols")
        self.symbols = symbols
        suffix = "fxpractice" if environment == "practice" else "fxtrade"
        self.rest = f"https://api-{suffix}.oanda.com/v3/accounts/{account}"
        self.feed = f"https://stream-{suffix}.oanda.com/v3/accounts/{account}/pricing/stream"
        self.headers = {"Authorization":f"Bearer {token}", "Accept-Datetime-Format":"RFC3339"}

    async def stream(self, http):
        async with http.get(self.feed, headers=self.headers, allow_redirects=False,
                            params={"instruments":",".join(s.replace("/","_") for s in self.symbols)}) as response:
            check_http(response)
            async for line in response.content:
                message = json.loads(line)
                if message.get("type") == "HEARTBEAT":
                    yield None
                elif message.get("instrument") in OANDA_SYMBOLS:
                    if message.get("status") == "tradeable" and message.get("bids") and message.get("asks"):
                        yield (OANDA_SYMBOLS[message["instrument"]], message.get("time"),
                               max((item["price"] for item in message["bids"]), key=float),
                               min((item["price"] for item in message["asks"]), key=float))
                    else:
                        yield None

    async def candles(self, http, symbol, interval, count):
        url = self.rest + "/instruments/" + symbol.replace("/","_") + "/candles"
        async with http.get(url, headers=self.headers, allow_redirects=False,
                            params={"price":"M","granularity":GRANULARITY[interval],"count":count}) as response:
            check_http(response)
            result = await response.json()
        return [(row["time"], *(row["mid"][key] for key in "ohlc"))
                for row in result["candles"] if row["complete"]]
