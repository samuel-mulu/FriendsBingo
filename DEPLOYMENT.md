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
| `CORS_ORIGINS` | Allowed frontend domains | `https://app.vercel.app,http://localhost:3000` |
| `NODE_ENV` | Environment mode | `production` |
| `PORT` | Server port (Render sets this) | `10000` |

### Optional Payment Variables

| Variable | Description |
|----------|-------------|
| `CHAPA_API_KEY` | Chapa payment gateway API key |
| `TELEBIRR_MERCHANT_ID` | Telebirr merchant ID |
| `TELEBIRR_APP_KEY` | Telebirr app key |
| `TELEBIRR_PRIVATE_KEY` | Telebirr private key |
| `CBE_ACCOUNT_NUMBER` | CBE bank account number |
| `CBE_ACCOUNT_LAST8` | Last 8 digits of CBE account |

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
- Use `*` to allow all origins (not recommended for production)
- Use comma-separated list for multiple origins: `https://app1.com,https://app2.com`

## Post-Deployment Checklist

- [ ] Database connected and migrated
- [ ] Environment variables configured
- [ ] Health check endpoint responding
- [ ] API docs accessible at `/docs` (if SWAGGER_ENABLED=true)
- [ ] Frontend can connect to API
- [ ] Socket.IO connections working
