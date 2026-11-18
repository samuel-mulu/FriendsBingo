# Friends Bingo Platform

Canonical terms for the Telegram integration boundary between the NestJS backend and the Next.js Mini App.

## Language

**Telegram Bot**:
The GrammY-based server component that acts exclusively as a Telegram Mini App launcher, receiving `/start` and `/play` commands to present the WebApp launch button and manage the persistent chat menu launcher. Owned exclusively by `Friends-bingo-backend`.
_Avoid_: Bot server, webhook app, TMA bot

**Telegram Mini App**:
The Next.js web application loaded inside a Telegram WebView via `web_app` buttons or `t.me/<bot>/<short_name>` direct links. Authenticates by sending Telegram `initData` to the backend. Holds zero bot secrets.
_Avoid_: Telegram bot, web bot, bot frontend

**Telegram Identity**:
The cryptographically verified Telegram user profile (`telegramId`, `telegramUsername`, `firstName`) extracted from either a Telegram Login Widget payload (HMAC-SHA256 of bot token) or Mini App `initData` (HMAC-SHA256 of `WebAppData` + bot token).
_Avoid_: Telegram session, Telegram profile, TG auth

**Linked Player**:
A `User` row in the database whose `telegramId` column is populated, meaning their Telegram Identity has been associated with a Friends Bingo account (which requires a verified Ethiopian phone number via SMS OTP).
_Avoid_: Telegram user, Telegram account, authenticated user

**Unlinked Telegram Visitor**:
A person who has opened the Telegram Bot or Mini App but whose Telegram Identity is not yet associated with a Friends Bingo `User` row (phone number linking is incomplete). Cannot play games, hold a wallet balance, or purchase cartelas.
_Avoid_: Guest user, anonymous player, unregistered user
