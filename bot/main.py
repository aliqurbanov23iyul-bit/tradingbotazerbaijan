import asyncio
from contextlib import suppress
import json
import logging
import os
from urllib.parse import urlsplit

import asyncpg
from aiogram import Bot, Dispatcher, F
from aiogram.filters import CommandStart
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, Message

ASSETS = ("XAU/USD", "EUR/USD", "GBP/USD", "BTC/USD")
DURATIONS = (3, 5, 10, 15, 30, 60, 180, 300, 900)
MENU = (
    ("📊 Siqnal Al", "signal"), ("🥇 Aktivlər", "assets"),
    ("⏱ Müddətlər", "durations"), ("👤 Hesabım", "account"),
    ("🔗 Qeydiyyat", "register"), ("📈 Statistika", "stats"),
    ("🆘 Dəstək", "help"),
)
WELCOME = (
    "🤖 Quick Trade AI sisteminə xoş gəlmisiniz!\n\n"
    "AI əsaslı bazar analizi və trading siqnalları üçün nəzərdə tutulmuş Telegram platforması.\n\n"
    "Davam etmək üçün hesabınızı aktivləşdirin."
)
UNAVAILABLE = "⚙️ Analiz sistemi hazırlanır. Hazır olduqda bu funksiya aktivləşdiriləcək."
dispatcher = Dispatcher()


def keyboard(items, back=True):
    rows = [[InlineKeyboardButton(text=label, callback_data=action)] for label, action in items]
    if back:
        rows.append([InlineKeyboardButton(text="← Əsas menyu", callback_data="menu")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def duration_label(seconds):
    return f"{seconds} saniyə" if seconds < 60 else f"{seconds // 60} dəqiqə"


async def settings(db, key):
    value = await db.fetchval("SELECT value FROM control_settings WHERE key=$1", key)
    return json.loads(value) if value else {}


async def touch(db, user):
    return await db.fetchrow(
        """INSERT INTO registrations(telegram_id, username, first_name, last_seen)
        VALUES($1,$2,$3,now())
        ON CONFLICT(telegram_id) DO UPDATE SET username=excluded.username,
        first_name=excluded.first_name,last_seen=now()
        RETURNING status,enabled""",
        str(user.id), user.username, user.first_name,
    )


async def market_available(db, symbol):
    return bool(await db.fetchval(
        "SELECT EXISTS(SELECT 1 FROM market_latest WHERE symbol=$1 AND status='Online')", symbol
    ))


async def registration(db):
    config = await settings(db, "affiliate")
    disclosure = config.get("disclosure", "")
    model = config.get("model")
    link = config.get("link", "")
    try:
        url = urlsplit(link)
        valid_link = url.scheme == "https" and bool(url.hostname) and not url.username and not url.password
    except ValueError:
        valid_link = False
    if not (valid_link and disclosure and model in {"loss-linked", "not-loss-linked"}):
        return "Qeydiyyat linki hələ konfiqurasiya edilməyib.", keyboard([])
    note = ("Komissiya istifadəçi itkilərindən asılıdır." if model == "loss-linked"
            else "Komissiya istifadəçi itkilərindən asılı deyil.")
    controls = keyboard([("Qeydiyyatımı yoxlayın", "review")])
    controls.inline_keyboard.insert(0, [InlineKeyboardButton(text="Tərəfdaş linki ilə qeydiyyat", url=link)])
    return f"Tərəfdaş linkindən komissiya əldə edə bilərik. {note}\n\n{disclosure}", controls


async def request_review(db, user_id):
    async with db.acquire() as connection, connection.transaction():
        status = await connection.fetchval(
            "SELECT status FROM registrations WHERE telegram_id=$1 FOR UPDATE", user_id
        )
        if status == "Verified":
            return "Hesabınız artıq təsdiqlənib."
        created = await connection.fetchval(
            """INSERT INTO affiliate_verifications(telegram_id)
            SELECT $1 WHERE NOT EXISTS (
                SELECT 1 FROM affiliate_verifications WHERE telegram_id=$1
                AND (status='Pending' OR requested_at>now()-interval '24 hours')
            ) RETURNING id""", user_id,
        )
        if created:
            await connection.execute("UPDATE registrations SET status='Pending',enabled=false WHERE telegram_id=$1", user_id)
            await connection.execute(
                """INSERT INTO control_logs(service,event,severity,message,actor)
                VALUES('Telegram','affiliate.request','Info','Verification requested',$1)""", user_id
            )
            return "Sorğunuz göndərildi. Admin qeydiyyatınızı əl ilə yoxlayacaq."
        return "Sorğu artıq mövcuddur və ya son 24 saatda göndərilib."


async def allow_update(db, user_id):
    return await db.fetchval(
        """INSERT INTO bot_callback_limits VALUES($1,now()+interval '1 second')
        ON CONFLICT(telegram_id) DO UPDATE SET next_at=excluded.next_at
        WHERE bot_callback_limits.next_at<=now() RETURNING telegram_id""", user_id
    )


@dispatcher.message(CommandStart(), F.chat.type == "private")
async def start(message: Message, db):
    if not await allow_update(db, str(message.from_user.id)):
        return
    user = await touch(db, message.from_user)
    config = await settings(db, "telegram")
    if config.get("maintenance"):
        await message.answer("🛠 Bot müvəqqəti texniki xidmətdədir.")
        return
    await message.answer(WELCOME, reply_markup=keyboard(MENU, back=False))
    if user["status"] != "Verified":
        text, markup = await registration(db)
        await message.answer(text, reply_markup=markup)


@dispatcher.callback_query()
async def callback(query, db):
    if not isinstance(query.message, Message) or query.message.chat.type != "private" or query.message.chat.id != query.from_user.id:
        await query.answer("Bu menyu yalnız şəxsi söhbətdə işləyir.")
        return
    action = query.data or ""
    kind, _, value = action.partition(":")
    if action not in {key for _, key in MENU} | {"menu", "review", "analyze"} and not (
        kind == "asset" and value in ASSETS or kind == "duration" and value in {str(s) for s in DURATIONS}
    ):
        await query.answer("Menyu seçimi etibarsızdır.")
        return
    user_id = str(query.from_user.id)
    if not await allow_update(db, user_id):
        await query.answer("Bir az gözləyib yenidən cəhd edin.")
        return
    await query.answer()
    user = await touch(db, query.from_user)
    config = await settings(db, "telegram")
    if config.get("maintenance"):
        await query.message.answer("🛠 Bot müvəqqəti texniki xidmətdədir.")
        return
    enabled = [seconds for seconds in DURATIONS if seconds in config.get("durations", DURATIONS)]
    if action == "menu":
        text, markup = "Əsas menyu", keyboard(MENU, back=False)
    elif action == "account":
        status = {"Pending":"Gözləyir", "Verified":"Təsdiqlənib", "Rejected":"Rədd edilib"}[user["status"]]
        access = "Aktiv" if user["enabled"] and user["status"] == "Verified" else "Bağlı"
        text, markup = f"👤 Hesabım\nTelegram ID: {user_id}\nQeydiyyat: {status}\nGiriş: {access}", keyboard([])
    elif action in {"register", "review"}:
        text, markup = await registration(db)
        if action == "review" and any(button.url for row in markup.inline_keyboard for button in row):
            text, markup = await request_review(db, user_id), keyboard([])
    elif action == "help":
        text, markup = os.getenv("BOT_SUPPORT_TEXT") or "Dəstək kanalı hələ konfiqurasiya edilməyib.", keyboard([])
    elif action == "stats":
        text, markup = "📈 Siqnal statistikası analiz sistemi qoşulduqda əlçatan olacaq.", keyboard([])
    elif action in {"signal", "analyze"} and (user["status"] != "Verified" or not user["enabled"]):
        text, markup = "Siqnal bölməsinə giriş üçün hesabınız təsdiqlənməli və aktiv olmalıdır.", keyboard([("🔗 Qeydiyyat", "register")])
    elif action in {"signal", "assets"}:
        text, markup = "Aktiv seçin. OTC aktivləri gələcəkdə əlavə olunacaq.", keyboard([(asset, "asset:"+asset) for asset in ASSETS])
    elif kind == "asset" and not await market_available(db, value):
        text, markup = "Bu aktiv üçün bazar məlumatları hazırda əlçatan deyil.", keyboard([("🥇 Aktivlər","assets")])
    elif kind == "asset":
        await db.execute(
            """INSERT INTO user_preferences(telegram_id,selected_asset) VALUES($1,$2)
            ON CONFLICT(telegram_id) DO UPDATE SET selected_asset=excluded.selected_asset""", user_id, value
        )
        text, markup = "Müddət seçin." if enabled else "Aktiv müddət yoxdur.", keyboard([(duration_label(s),f"duration:{s}") for s in enabled])
    elif action == "durations":
        text, markup = "Müddət seçin." if enabled else "Aktiv müddət yoxdur.", keyboard([(duration_label(s),f"duration:{s}") for s in enabled])
    elif kind == "duration" and int(value) in enabled:
        prefs = await db.fetchrow(
            """INSERT INTO user_preferences(telegram_id,selected_duration) VALUES($1,$2)
            ON CONFLICT(telegram_id) DO UPDATE SET selected_duration=excluded.selected_duration RETURNING selected_asset""",
            user_id, int(value),
        )
        asset = prefs["selected_asset"]
        text = f"{asset} · {duration_label(int(value))}" if asset else "Müddət saxlanıldı. Aktiv seçin."
        markup = keyboard([("Analiz et","analyze")] if asset else [("🥇 Aktivlər","assets")])
    elif action == "analyze":
        prefs = await db.fetchrow("SELECT * FROM user_preferences WHERE telegram_id=$1", user_id)
        if prefs and prefs["selected_asset"] in ASSETS and prefs["selected_duration"] in enabled:
            if await market_available(db, prefs["selected_asset"]):
                text, markup = UNAVAILABLE, keyboard([])
            else:
                text, markup = "Bu aktiv üçün bazar məlumatları hazırda əlçatan deyil.", keyboard([("🥇 Aktivlər","assets")])
        else:
            text, markup = "Aktiv və aktivləşdirilmiş müddət seçin.", keyboard([("🥇 Aktivlər","assets")])
    else:
        text, markup = "Bu müddət artıq aktiv deyil.", keyboard([("⏱ Müddətlər","durations")])
    await query.message.answer(text, reply_markup=markup)


async def bot_error(db, error):
    name = type(error).__name__
    logging.error("Telegram operation failed (%s)", name)
    try:
        await db.execute(
            """INSERT INTO control_logs(service,event,severity,message)
            VALUES('Telegram','bot.error','Error',$1)""", name
        )
    except Exception:
        logging.error("Could not persist Telegram error")


@dispatcher.errors()
async def handler_error(event, db):
    await bot_error(db, event.exception)
    return True


async def heartbeat(bot, db):
    while True:
        try:
            account = await bot.get_me()
            await db.execute(
                """INSERT INTO bot_runtime(id,username,last_heartbeat) VALUES(1,$1,now())
                ON CONFLICT(id) DO UPDATE SET username=excluded.username,last_heartbeat=now()""", account.username
            )
        except Exception as error:
            await bot_error(db, error)
        await asyncio.sleep(20)


async def main():
    logging.basicConfig(level=logging.WARNING)
    async with Bot(os.environ["TELEGRAM_BOT_TOKEN"]) as bot:
        async with asyncpg.create_pool(os.environ["DATABASE_URL"], min_size=1, max_size=4) as db:
            if (await bot.get_webhook_info()).url:
                raise RuntimeError("Remove the existing webhook before starting polling.")
            # A dedicated session lock requires a direct or session-pooled database URL.
            async with db.acquire() as lease:
                if not await lease.fetchval("SELECT pg_try_advisory_lock(912802, 1)"):
                    raise RuntimeError("A polling worker is already running for this database.")
                pulse = asyncio.create_task(heartbeat(bot, db))
                try:
                    await dispatcher.start_polling(bot, db=db, allowed_updates=["message","callback_query"],
                                                   close_bot_session=False)
                finally:
                    pulse.cancel()
                    with suppress(asyncio.CancelledError):
                        await pulse
                    await lease.execute("UPDATE bot_runtime SET last_heartbeat=NULL WHERE id=1")
                    await lease.execute("SELECT pg_advisory_unlock(912802, 1)")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        logging.error("Bot stopped (%s)", type(error).__name__)
        raise SystemExit(1) from None
