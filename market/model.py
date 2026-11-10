from datetime import datetime, timezone
from decimal import Decimal

SYMBOLS = ("XAU/USD", "EUR/USD", "GBP/USD", "BTC/USD")
INTERVALS = (60, 300, 900, 3600)


def utc_now():
    return datetime.now(timezone.utc)


def timestamp(value):
    date = (datetime.fromtimestamp(value, timezone.utc) if type(value) is int
            else datetime.fromisoformat(value.replace("Z", "+00:00")))
    if date.tzinfo is None:
        raise ValueError("missing timezone")
    return date.astimezone(timezone.utc)


def price(value):
    number = Decimal(str(value))
    if not number.is_finite() or not Decimal("0.000000000001") <= number < 10**15:
        raise ValueError("invalid price")
    return number


def quote(symbol, at, bid, ask, now):
    at, bid, ask = timestamp(at), price(bid), price(ask)
    age = (now - at).total_seconds()
    if symbol not in SYMBOLS or not -5 <= age <= 86400 or bid > ask:
        raise ValueError("invalid quote")
    return symbol, at, bid, ask, now


def candle(at, interval, opening, high, low, close, now):
    at = timestamp(at)
    opening, high, low, close = map(price, (opening, high, low, close))
    if (interval not in INTERVALS or at.microsecond or int(at.timestamp()) % interval
            or at.timestamp() + interval > now.timestamp() or at.year < 2000
            or not low <= min(opening, close) <= max(opening, close) <= high):
        raise ValueError("invalid candle")
    return at, opening, high, low, close


def missing_buckets(rows, interval):
    times = sorted({row[0] for row in rows})
    return sum(max(0, int((b-a).total_seconds()) // interval - 1) for a,b in zip(times,times[1:]))
