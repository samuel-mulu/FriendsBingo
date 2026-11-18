# Backend Owns the Telegram Bot Webhook

The NestJS backend (`Friends-bingo-backend`) is the single owner of the Telegram Bot token, webhook endpoint (`POST /telegram/webhook`), bot commands, and outbound bot notifications. The Next.js Mini App (`bingo-game-tg-bot`) is a pure frontend client that holds zero bot secrets and communicates exclusively through REST API and Socket.IO.

We considered hosting the bot webhook on the Next.js Vercel deployment (`POST /api/bot`), which had the advantage of a single deploy target. We rejected it because the bot commands (`/games`, `/wallet`) require direct Prisma database access to query `GameSlot` rows and `User.wallet` balances — routing these through an HTTP API round-trip from Vercel to the backend adds latency, failure modes, and a redundant auth layer. Keeping the bot in the backend also means a single secret owner (the bot token never leaves the backend environment), and the `TelegramService` can be injected into other backend services for outbound notifications (game results, deposit confirmations) without cross-service HTTP calls.

## Considered Options

- **Next.js Vercel `/api/bot`**: Single deploy, but no direct DB access, bot token leaks to frontend host, and serverless cold starts add webhook latency.
- **NestJS `/telegram/webhook`** (chosen): Direct Prisma access, single secret owner, injectable `TelegramService` for notifications.
- **Dedicated bot microservice**: Maximum isolation, but unjustified operational overhead for a single bot with five commands.
