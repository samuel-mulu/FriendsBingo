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
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/dbname` |
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

1. Create a PostgreSQL database on Render
2. Copy the **Internal Database URL** or **External Database URL**
3. Add it as `DATABASE_URL` environment variable

### Running Migrations

After first deploy, run migrations:
```bash
# Via Render Shell
npx prisma migrate deploy
```

Or add to build command:
```yaml
buildCommand: npm install && npx prisma migrate deploy && npm run build
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
