import asyncio
from hmac import compare_digest
from http.server import BaseHTTPRequestHandler
import json
import logging
import os
import ssl
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import asyncpg
from aiogram import Bot
from aiogram.types import Update
from pydantic import ValidationError

from bot.main import dispatcher


async def process_update(update):
    url = urlsplit(os.environ["DATABASE_URL"])
    query = [(key, value) for key, value in parse_qsl(url.query)
             if key not in {"channel_binding", "sslmode"}]
    dsn = urlunsplit(url._replace(query=urlencode(query)))
    async with Bot(os.environ["TELEGRAM_BOT_TOKEN"]) as bot:
        async with asyncpg.create_pool(
            dsn, ssl=ssl.create_default_context(), statement_cache_size=0,
            min_size=1, max_size=2, timeout=5, command_timeout=5,
        ) as db:
            await dispatcher.feed_update(bot, update, db=db)
            await db.execute(
                """INSERT INTO bot_runtime(id,last_heartbeat) VALUES(1,now())
                ON CONFLICT(id) DO UPDATE SET last_heartbeat=now()"""
            )


class handler(BaseHTTPRequestHandler):
    def respond(self, status):
        self.send_response(status)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def do_POST(self):
        secret = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "")
        provided = self.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
        if not secret or not compare_digest(secret.encode(), provided.encode()):
            self.respond(403)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 262144:
                self.respond(413)
                return
            update = Update.model_validate(json.loads(self.rfile.read(length)))
        except (ValueError, ValidationError):
            self.respond(400)
            return
        try:
            asyncio.run(process_update(update))
        except Exception as exc:
            logging.error("Telegram webhook failed (%s)", type(exc).__name__)
            self.respond(503)
            return
        self.respond(204)
