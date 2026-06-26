# Friends Bingo API - Deployment Guide

## Deploy to Render (Recommended)

### Option 1: Using render.yaml (Blueprint)

1. Push your code to GitHub
2. In Render Dashboard, click "New +" → "Blueprint"
3. Connect your GitHub repository
4. Render will automatically detect `render.yaml` and configure the service
5. Add your environment variables (marked as `sync: false` in render.yaml)

### Option 2: Manual Configuration

1. Create a new **Web Service**
2. Connect your GitHub repository
3. Configure:
   - **Runtime**: Node
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm run start:prod`
   - **Plan**: Starter (or higher for production)

### Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string (pooled OK for the app) | `postgresql://user:pass@host:5432/dbname` |
| `DIRECT_URL` | **Neon only:** non-pooler URL for migrations (recommended) | `postgresql://user:pass@ep-xxx.region.aws.neon.tech/db?sslmode=require` |
| `JWT_SECRET` | Secret for JWT signing | `your-super-secret-key-min-16-chars` |
| `JWT_EXPIRES_IN` | Token expiration | `7d` |
| `CORS_ORIGINS` | **Required in production.** Browser frontend URLs only (not `*`). Flutter mobile does **not** need to be listed. | `https://friends-bingo-admin.vercel.app` |
| `NODE_ENV` | Environment mode | `production` |
| `PORT` | Server port (Render sets this) | `10000` |

### Optional Payment Variables

| Variable | Description |
|----------|-------------|
| `CHAPA_API_KEY` | Chapa payment gateway API key |
| `TELEBIRR_MERCHANT_ID` | Telebirr merchant ID |
| `TELEBIRR_APP_KEY` | Telebirr app key |
| `TELEBIRR_PRIVATE_KEY` | Telebirr private key |
| `VERIFY_ET_API_KEY` | Verify.ET API key (deposit verification) |
| `VERIFY_ET_BASE_URL` | Verify.ET base URL (default `https://verify.et`) |
| `VERIFY_ET_WAIT_MS` | Initial Verify.ET wait (default `5000`) |
| `VERIFY_ET_POLL_ATTEMPTS` | Verify.ET poll attempts |
| `VERIFY_ET_POLL_INTERVAL_MS` | Verify.ET poll interval ms |
| `TELEBIRR_SETTLEMENT_ACCOUNT` | Telebirr settlement account for Verify.ET |
| `CBE_SETTLEMENT_ACCOUNT` | CBE settlement account for Verify.ET |
| `AWASH_SETTLEMENT_ACCOUNT` | Awash settlement account for Verify.ET |
| `BOA_SETTLEMENT_ACCOUNT` | BOA settlement account for Verify.ET |
| `CBE_ACCOUNT_SUFFIX` | Required 8-digit CBE account suffix for Verify.ET (last 8 digits of settlement account; legacy alias: `CBE_ACCOUNT_LAST8`) |
| `BOA_ACCOUNT_SUFFIX` | Optional 5+ digit BOA account suffix for Verify.ET (last 5 digits are sent; defaults to last 5 of `BOA_SETTLEMENT_ACCOUNT`) |
| `TELEBIRR_RECEIVER_PHONE` | Telebirr receiver phone (app UI hints only) |
| `TELEBIRR_RECEIVER_PHONE_LAST4` | Last 4 digits for Telebirr preview UI |
| `TELEBIRR_RECEIVER_NAME` | Receiver name shown on deposit screen (copyable account card) |
| `CBE_RECEIVER_NAME` | CBE receiver name shown on deposit screen |
| `AWASH_RECEIVER_NAME` | Awash receiver name shown on deposit screen |
| `BOA_RECEIVER_NAME` | Bank of Abyssinia receiver name shown on deposit screen |
| `TELEBIRR_RECEIPT_BASE_URL` | Telebirr receipt URL base for app preview |

### Android APK self-update (sideload / outside Play Store)

Public endpoint: `GET /app-version/android` (no auth). Used by the Flutter Android app on cold start to show an optional or forced update modal.

| Variable | Description | Example |
|----------|-------------|---------|
| `ANDROID_LATEST_VERSION` | Human-readable latest version (name only, no `+build`) | `1.1.6` |
| `ANDROID_LATEST_VERSION_CODE` | Latest Android `versionCode` (pubspec `+N`) | `7` |
| `ANDROID_MINIMUM_VERSION_CODE` | Below this build → force update | `7` |
| `ANDROID_APK_DOWNLOAD_URL` | Direct APK download URL (e.g. GitHub Releases) | `https://github.com/.../app-release.apk` |
| `ANDROID_APK_SHA256` | SHA-256 of APK (display/log only for now) | 64-char hex |
| `ANDROID_RELEASE_NOTES` | Shown in optional update modal | `Bug fixes` |
| `ANDROID_FORCE_UPDATE` | `true` → all users below latest see force modal | `false` |

**Important:** use **two separate variables**. Do not put `1.1.6+7` in one env var — the app compares **build numbers only** (`ANDROID_LATEST_VERSION_CODE` vs the installed `+N` from pubspec). After changing env on Render, redeploy or restart the service, then verify with `GET /app-version/android`.

**Manual release process:**

1. Bump Flutter `pubspec.yaml`: `version: 2.4.1+5` (`+5` = Android `versionCode`).
2. Build: `flutter build apk --release`.
3. Upload APK to GitHub Releases; copy the asset URL.
4. Update backend env (`ANDROID_*` above), including `ANDROID_APK_SHA256` (`sha256sum` / `Get-FileHash`).
5. Restart the API.
6. APKs that **already include** the in-app update check will see the modal on next cold start.

**Important:** APKs built **before** this feature cannot self-notify. Announce those users once via website, SMS, or Telegram.

## Database Setup

### Render PostgreSQL

1. Create a PostgreSQL database on Render
2. Copy the **Internal Database URL** or **External Database URL**
3. Add it as `DATABASE_URL` environment variable

### Neon PostgreSQL (recommended for this project)

Use **two** connection strings from the Neon dashboard:

| Render env var | Neon dashboard tab | Hostname |
|----------------|-------------------|----------|
| `DATABASE_URL` | **Pooled connection** | contains `-pooler` |
| `DIRECT_URL` | **Direct connection** | does **not** contain `-pooler` |

The API runtime uses `DATABASE_URL`. Prisma migrations use `DIRECT_URL` when set.

If `DIRECT_URL` is omitted, the build auto-derives a direct URL from a Neon pooler `DATABASE_URL` by removing `-pooler` from the host.

### Running Migrations

Migrations run during the Render build (`npm run migrate:deploy`).

If deploy fails with **P1002 advisory lock timeout**:

1. Ensure `DIRECT_URL` is the **non-pooler** Neon URL (not the pooler URL).
2. In Neon SQL Editor, release a stuck Prisma migration lock from a previous failed deploy:
   ```sql
   SELECT pg_terminate_backend(l.pid)
   FROM pg_locks AS l
   WHERE l.locktype = 'advisory' AND l.objid = 72707369;
   ```
3. Redeploy once (avoid overlapping deploys).

Manual migration via Render Shell:
```bash
npm run migrate:deploy
```

## Socket.IO Configuration

Socket.IO is automatically configured and will work with your deployed frontend. No additional setup needed.

## Health Check Endpoint

The API includes a health check at `GET /health` for monitoring.

## CORS Configuration

CORS is configured via `CORS_ORIGINS` environment variable:

**Local development / test (`NODE_ENV=development` or `test`):**
- Defaults to `CORS_ORIGINS=*` (all origins allowed)
- You can override in `.env` if needed, e.g. `http://localhost:3000,http://localhost:*`

**Production (`NODE_ENV=production`):**
- `*` is **rejected** at startup — the API will not boot with wildcard CORS
- List **browser** frontends only (your Vercel admin panel):
  ```
  CORS_ORIGINS=https://friends-bingo-admin.vercel.app
  ```
- **Flutter mobile (iOS/Android) does not use CORS** — do not add a mobile app URL here
- Only add Flutter **web** URLs if you deploy the app to the web
- Each entry must start with `http://` or `https://`

**Local development:** `CORS_ORIGINS` defaults to `*` when unset. Do not use `*` in production.

## AUTO Called Numbers Sync (Support Runbook)

This section explains how called numbers flow during **AUTO** live play so support staff can answer player questions (“my phone is behind”, “different ball than my friend”).

### Source of truth

- **PostgreSQL** `calledNumbers` table: each draw has a monotonic `order` (1…75) and unique `number` (1…75) per session.
- **Bingo wins are validated on the server** against this list. What a phone screen shows does **not** decide who wins.

### Per-draw pipeline

1. `AutoCallService` ticks every **1 second** when `PLAYING`, `autoCallEnabled`, and `nextAutoCallAt <= now`.
2. Server inserts the ball, then emits **`game:number_called`** to session room, admin room, and `games:public`.
3. Server does **not** emit `game:operation_updated` on every ball (by design). `GET /games/operations/current` `calledNumbersCount` may lag until the next structural refresh or poll.

### What each client does

| Client | How it receives balls | Typical lag |
|--------|----------------------|-------------|
| **Admin panel** | Socket → immediate cache update | ~0 ms (socket RTT) |
| **Flutter player (normal)** | Socket → in-order append to strip | ~0 ms + network RTT (~0.1–0.5 s) |
| **Flutter player (reconnect / gap)** | `GET /games/sessions/:id/called-numbers` + optional stagger replay | up to ~2–3 s on poor networks |
| **operations/current** | Metadata only; not pushed per ball | May lag until poll |

Global timing (Time Config): `autoCallIntervalSeconds` (default 7), `flutterRefetchDebounceMs` (400), `missedNumberAnimationMs` (150), `missedNumberStaggerMaxBalls` (10).

### When players can briefly see different latest balls

| Situation | Fairness impact | Expected? |
|-----------|-------------------|-----------|
| Normal socket latency between phones | None | Yes |
| One phone reconnecting / catching up | None | Yes |
| One player submitting a bingo claim (strip pauses for that player only) | None | Yes |
| Admin socket disconnected | Admin only; up to ~5 s poll lag | Yes |
| Two API instances without Redis adapter | DB constraints prevent duplicate draws; rare ops edge | Investigate if suspected |

After sync settles, all clients should show the **same set** of called numbers. The **latest ball** may appear fractions of a second apart — normal at 7 s draw intervals.

### Player app UI signals (Flutter)

- **Live** chip (green) — strip matches server stream.
- **Catching up…** chip (amber) — gap recovery or stagger replay in progress.
- **#N** badge — server draw order for the latest ball.
- Help text: numbers sync from the server; brief delay on slow connections is normal.

### Support responses

- “My friend saw the ball before me” → Normal realtime delay; both lists match after a moment. Wins use server data.
- “My app says Catching up…” → Network catch-up; should clear within a few seconds.
- “Numbers stopped during my claim” → Expected; new balls appear after the claim finishes.
- “Admin and player counts differ” → Check admin socket connection; player uses `called-numbers` API as reconcile source.

## Deploy with Docker (Ubuntu VPS)

Self-hosted deployment using Docker Compose: PostgreSQL in a separate container, API on port **4000**, Nginx on the host for TLS and reverse proxy.

### Architecture

- **postgres** — PostgreSQL 16 (persistent volume `postgres_data`)
- **api** — NestJS app built from multi-stage `Dockerfile` (`node:22-alpine`)
- **Nginx** (on host) — proxies `https://api.yourdomain.com` → `http://127.0.0.1:4000`

### One-time VPS setup

```bash
# Install Docker Engine + Compose plugin
# https://docs.docker.com/engine/install/ubuntu/

sudo usermod -aG docker $USER
newgrp docker

git clone <your-repo-url> /opt/friends-bingo-api
cd /opt/friends-bingo-api
nano .env   # create with secrets; see table below + env.validation.ts
```

Add these **in addition** to your existing required variables (see `src/config/env.validation.ts`):

| Variable | Description | Example |
|----------|-------------|---------|
| `POSTGRES_USER` | Postgres superuser for Compose | `friends` |
| `POSTGRES_PASSWORD` | Postgres password (required by Compose) | strong random password |
| `POSTGRES_DB` | Database name | `friends_bingo` |
| `PORT` | API listen port inside container | `4000` |
| `NODE_ENV` | Must be `production` | `production` |
| `CORS_ORIGINS` | Browser admin URL(s) | `https://your-admin-domain.com` |

`docker-compose.yml` sets `DATABASE_URL` and `DIRECT_URL` to the `postgres` service hostname automatically. You do **not** need Neon-style pooler URLs on self-hosted Postgres.

### Build and start

```bash
cd /opt/friends-bingo-api

# Build the API image
docker compose build api

# Apply migrations (run once per deploy, before or while stack is up)
docker compose run --rm api npx prisma migrate deploy

# Start postgres + api
docker compose up -d

# Verify
docker compose ps
docker compose logs -f api
curl -s http://127.0.0.1:4000/health
```

### Rolling update (after `git pull`)

```bash
docker compose build api
docker compose run --rm api npx prisma migrate deploy
docker compose up -d api
```

### Prisma migrations

Run migrations as an explicit deploy step (not on every container boot):

```bash
docker compose run --rm api npx prisma migrate deploy
docker compose run --rm api npx prisma migrate status
```

Optional seeds on a **fresh** database:

```bash
docker compose run --rm api npm run seed:game-rules
docker compose run --rm api npm run seed:cartelas
```

### Nginx reverse proxy (host)

Example `/etc/nginx/sites-available/friends-api`:

```nginx
server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    # ssl_certificate /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
    }
}
```

Enable and reload:

```bash
sudo ln -s /etc/nginx/sites-available/friends-api /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

The API sets `trust proxy` for correct client IP behind Nginx.

### Docker health checks

| Probe | URL |
|-------|-----|
| Container `HEALTHCHECK` | `GET http://127.0.0.1:4000/health` |
| External monitor | `GET https://api.yourdomain.com/health` |

Returns `503` if the database is unreachable.

### Docker troubleshooting

| Symptom | Fix |
|---------|-----|
| Nginx `connection refused` | Ensure `main.ts` listens on `0.0.0.0` and `PORT=4000` |
| `P1001` database unreachable | `DATABASE_URL` must use host `postgres`, not `localhost` |
| Env validation crash on boot | `docker compose logs api`; fill all required vars |
| Prisma engine error on Alpine | Rebuild image; Dockerfile installs `openssl` + `libc6-compat` |
| Socket.IO fails via domain | Nginx must pass `Upgrade` / `Connection` headers |
| `FIREBASE_PRIVATE_KEY` errors | Use `\n` for newlines in `.env` |
| Migration P1002 lock | Do not run overlapping `migrate deploy`; see Neon lock SQL above if stuck |

```bash
docker compose logs -f api
docker compose exec api sh
docker compose exec postgres psql -U friends -d friends_bingo -c '\dt'
```

## Post-Deployment Checklist

- [ ] Database connected and migrated
- [ ] Environment variables configured
- [ ] Health check endpoint responding
- [ ] API docs accessible at `/docs` (if SWAGGER_ENABLED=true)
- [ ] Frontend can connect to API
- [ ] Socket.IO connections working
