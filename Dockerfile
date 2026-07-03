# syntax=docker/dockerfile:1

# --- Stage 1: install all deps (incl. dev) for build ---
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat
COPY package.json package-lock.json ./
RUN npm ci

# --- Stage 2: compile NestJS + generate Prisma client ---
FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# DATABASE_URL only needed for config resolution during generate (dummy OK)
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN npx prisma generate
RUN npm run build

# --- Stage 3: production runtime ---
FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

# Prisma engine + pg need OpenSSL on Alpine
RUN apk add --no-cache openssl libc6-compat

# Non-root user (Docker best practice)
RUN addgroup -S nestjs && adduser -S nestjs -G nestjs

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Prisma schema, migrations, and config for `migrate deploy`
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
COPY src ./src

ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV DIRECT_URL="postgresql://build:build@localhost:5432/build"

RUN npx prisma generate

COPY --from=build /app/dist ./dist
COPY --from=build /app/src/cartelas/cartelas.json ./src/cartelas/cartelas.json

RUN chown -R nestjs:nestjs /app
USER nestjs

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
