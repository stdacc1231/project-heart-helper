"""
Autoscript Telegram bot.

Managed from the web panel (token, welcome text, payment instructions,
auto-delete minutes).  Users:

    /start   -> welcome + plan buttons
    /me      -> show their linked accounts
    /buy <plan> -> receive payment instructions, prompted to upload proof
    (photo) -> uploaded as proof, admins approve in the web panel
    /help    -> show commands

When an admin approves a payment in the panel, the agent POSTs a task here
via a shared secret; the bot delivers the config to the user and schedules
auto-deletion of that message after N minutes.

The bot only ever talks to the agent's internal HTTP API — all business
rules live in one place.
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Dict

import httpx
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import (
    Application, CommandHandler, ContextTypes, MessageHandler, CallbackQueryHandler, filters,
)

logging.basicConfig(level=logging.INFO, format="bot %(levelname)s %(message)s")
log = logging.getLogger("bot")

AGENT_URL = os.environ.get("AGENT_URL", "http://127.0.0.1:8088")
INTERNAL_TOKEN = os.environ.get("BOT_INTERNAL_TOKEN", "")

async def agent(method: str, path: str, **kwargs) -> Dict[str, Any]:
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.request(method, f"{AGENT_URL}{path}",
                            headers={"X-Internal-Token": INTERNAL_TOKEN}, **kwargs)
        r.raise_for_status()
        return r.json()


async def schedule_delete(context: ContextTypes.DEFAULT_TYPE, chat_id: int, message_id: int, minutes: int):
    if minutes <= 0:
        return
    async def _job():
        await asyncio.sleep(minutes * 60)
        try:
            await context.bot.delete_message(chat_id=chat_id, message_id=message_id)
        except Exception as e:
            log.warning("delete_message failed: %s", e)
    asyncio.create_task(_job())


async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    settings = await agent("GET", "/bot")
    plans = await agent("GET", "/plans")
    kb = [
        [InlineKeyboardButton(f"{p['name']} — ${p['priceCents']/100:.2f}", callback_data=f"buy:{p['id']}")]
        for p in plans if p.get("active")
    ]
    kb.append([InlineKeyboardButton("My accounts", callback_data="me")])
    await update.message.reply_text(
        settings.get("welcomeText") or "Welcome!",
        reply_markup=InlineKeyboardMarkup(kb),
    )


async def cmd_me(update: Update, context: ContextTypes.DEFAULT_TYPE):
    tg_id = str(update.effective_user.id)
    try:
        accts = await agent("GET", f"/bot/accounts/{tg_id}")
    except Exception:
        accts = []
    if not accts:
        await update.message.reply_text("You have no accounts yet. /start to buy one.")
        return
    lines = [f"• {a['protocol'].upper()} — {a['username']} (exp {a['expiresAt'][:10]})" for a in accts]
    await update.message.reply_text("\n".join(lines))


async def on_button(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    if q.data == "me":
        return await cmd_me(update, context)
    if q.data.startswith("buy:"):
        plan_id = q.data.split(":", 1)[1]
        settings = await agent("GET", "/bot")
        text = (
            f"Plan selected. Payment details:\n\n{settings.get('paymentInstructions','')}\n\n"
            "When paid, reply here with a screenshot of the receipt."
        )
        msg = await q.message.reply_text(text)
        # remember the plan the user is buying
        context.user_data["pending_plan"] = plan_id
        await schedule_delete(context, msg.chat_id, msg.message_id,
                              settings.get("autoDeleteMinutes", 10))


async def on_photo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    plan_id = context.user_data.get("pending_plan")
    if not plan_id:
        return await update.message.reply_text("Please pick a plan first with /start.")
    photo = update.message.photo[-1]
    file = await photo.get_file()
    # Ask agent to record the payment; agent downloads via file_id
    await agent("POST", "/bot/payments", json={
        "telegramId": str(update.effective_user.id),
        "telegramName": update.effective_user.username or update.effective_user.full_name,
        "planId": plan_id,
        "fileId": file.file_id,
    })
    context.user_data.pop("pending_plan", None)
    await update.message.reply_text("Received. An admin will approve shortly.")


async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("/start – buy a plan\n/me – my accounts\n/help – this help")


def build_app(token: str) -> Application:
    app = Application.builder().token(token).build()
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("me", cmd_me))
    app.add_handler(CommandHandler("help", cmd_help))
    app.add_handler(CallbackQueryHandler(on_button))
    app.add_handler(MessageHandler(filters.PHOTO, on_photo))
    return app


async def main():
    while True:
        try:
            settings = await agent("GET", "/bot")
        except Exception as e:
            log.error("agent not ready: %s — retrying in 5s", e); await asyncio.sleep(5); continue
        token = settings.get("token")
        if not (settings.get("enabled") and token):
            log.info("bot disabled or no token, sleeping 30s"); await asyncio.sleep(30); continue
        app = build_app(token)
        log.info("bot starting")
        await app.initialize(); await app.start(); await app.updater.start_polling()
        # poll every 60s to see if settings changed
        try:
            while True:
                await asyncio.sleep(60)
                current = await agent("GET", "/bot")
                if current.get("token") != token or not current.get("enabled"):
                    log.info("settings changed, restarting bot"); break
        finally:
            await app.updater.stop(); await app.stop(); await app.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
