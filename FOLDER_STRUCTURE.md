# Friends Bingo Backend — Complete Architecture, Routes & Folder Structure Guide

> **Project**: Friends Bingo Backend API (`Friends-bingo-backend`)  
> **Framework**: NestJS 11 (`@nestjs/core ^11.0.1`), Express  
> **Database & ORM**: PostgreSQL, Prisma ORM (`^6.6.0`)  
> **Realtime & In-Memory**: Socket.IO (`^4.8.1`), Redis (`ioredis ^5.6.1`, `@socket.io/redis-adapter ^8.3.0`)  
> **Authentication**: Passport JWT (`@nestjs/jwt`, `@nestjs/passport`), Bcrypt, Refresh Token rotation  
> **Validation & Security**: `class-validator`, `class-transformer`, `@nestjs/throttler`, CORS Origin Checker  
> **External Integrations**: Firebase Admin SDK (Push), GeezSMS (SMS OTP), Verify-ET (Telebirr/CBE Verification)

---

## Table of Contents
1. [High-Level Architectural Overview](#1-high-level-architectural-overview)
2. [Complete Directory & File Structure](#2-complete-directory--file-structure)
3. [Exhaustive API Routes & Controller Catalog](#3-exhaustive-api-routes--controller-catalog)
4. [Services & Core Business Logic Architecture](#4-services--core-business-logic-architecture)
5. [Database Persistence, Models & Concurrency Locking](#5-database-persistence-models--concurrency-locking)
6. [Realtime WebSocket (Socket.IO & Redis) Architecture](#6-realtime-websocket-socketio--redis-architecture)
7. [Validation, Security & Request Pipeline](#7-validation-security--request-pipeline)
8. [Background Schedulers & Repair Jobs](#8-background-schedulers--repair-jobs)

---

## 1. High-Level Architectural Overview

The backend is built as a **Modular Domain-Driven Monolith** optimized for low-latency live betting and concurrent state transitions:

```
src/
├── main.ts                    # Bootstrap entrypoint (NestFactory, CORS, Pipes, Filters, Redis Adapter)
├── app.module.ts              # Root module configuring Throttler, Config, and feature modules
├── app.setup.ts               # Shared setup configuration for app & end-to-end tests
├── config/                    # Environment validation schema (Joi) & dynamic CORS config
├── common/                    # Global interceptors, filters, rate limiters, pagination, phone utils
├── prisma/                    # PrismaService, connection health retry & performance logging extension
├── realtime/                  # Socket.IO Gateway, Redis IO Adapter, Batched room emitters
├── auth/                      # OTP, JWT, Refresh Token rotation, Telegram Login, Multi-device sessions
├── admin/                     # Admin control portal (Slots, Economy, Reports, Payouts, Broadcasts)
├── games/                     # Live game sessions, slot queues, cartela reservations, economics
│   ├── big-game-round.module.ts
│   ├── big-game-ticket.module.ts
│   ├── chain-round.module.ts
│   ├── operations-cache.module.ts
│   └── post-game-registration-opener.module.ts
├── game-engine/               # Status transitions (NEXT -> READY -> PLAYING -> WINNER_WINDOW -> FINISHED)
├── game-rules/                # Combinatorial winning pattern evaluators (Lines, Shapes, Full House)
├── game-timing-config/        # Dynamic game countdown and ball calling timing settings
├── cartelas/                  # Master 5x5 cartela board generator and catalog
├── called-numbers/            # Cryptographic random ball caller & monotonic sequence tracker
├── bingo-claims/              # Concurrent claim verification, atomic row locking, multi-winner prize splits
├── deposits/                  # Payment submission, reference duplicate checks, automated receipt verification
├── deposit-approval-config/   # Local/Remote Telebirr receipt parser & validator
├── withdrawals/               # Payout requests, admin approval, transaction status transitions
├── wallet/                    # User balances (Playable Cash, Bonus Cartelas, Locked) & ledger
├── users/                     # User management, feature grants (auto-mark, auto-bingo), bans
├── notifications/             # Firebase Cloud Messaging with batching, delivery guards, rate limiting
├── notification-config/       # Notification delivery settings
├── app-display-config/        # Live branding, promotional banners, UI display overrides
├── app-version/               # Mandatory & optional Android build enforcement
├── sms/                       # GeezSMS gateway integration & delivery webhooks
├── support/                   # Player support message ticketing & admin replies
├── observability/             # Prometheus metrics endpoint, query latency tracking, socket counts
├── verify-et/                 # Third-party telebirr payment verification API client
└── seed/                      # Database seeders (Admin accounts, cartelas, rules, timing configs)
```

---

## 2. Complete Directory & File Structure

Below is the complete file-by-file map of the backend codebase:

### Root Files & App Setup
```
src/
├── main.ts                                           # Bootstraps NestJS app with Redis IO Adapter & global pipes
├── app.controller.ts                                 # Root controller with basic health ping
├── app.module.ts                                     # Root NestJS module importing all sub-modules
├── app.service.ts                                    # Root service
├── app.setup.ts                                      # Configures CORS, global pipes, and filters for app & tests
├── GameRule.json                                     # Default winning pattern definitions
```

### Modules Map
```
src/
├── admin/
│   ├── admin-broadcasts.service.ts                   # Creates and delivers urgent/banner broadcast messages
│   ├── admin-expenses.service.ts                     # Tracks operational expenses & ledger entries
│   ├── admin-reports.service.ts                      # Computes gross revenue, net payout, and player margins
│   ├── admin.controller.ts                           # 45+ endpoints for the administrative dashboard
│   ├── admin.module.ts                               # Admin module definition
│   ├── financial-report-accounting.util.ts           # Financial aggregation and margin formulas
│   ├── financial-report-accounting.util.spec.ts
│   └── dto/
│       ├── change-admin-password.dto.ts              # Password change payload
│       ├── create-admin-broadcast.dto.ts             # Broadcast message creation payload
│       ├── create-expense.dto.ts                     # Expense logging payload
│       ├── date-range-query.dto.ts                   # Date filtering query
│       └── financial-report-query.dto.ts             # Financial report filter query
├── app-display-config/
│   ├── app-display-config.defaults.ts                # Default display banners and UI toggle values
│   ├── app-display-config.module.ts
│   ├── app-display-config.service.ts                 # Service managing dynamic app branding & banners
│   ├── app-display-config.types.ts
│   └── dto/update-app-display-config.dto.ts
├── app-version/
│   ├── app-version.controller.ts                     # Returns latest Android build and minimum required build
│   ├── app-version.module.ts
│   └── app-version.service.ts                        # Evaluates semver & build numbers for force updates
├── auth/
│   ├── auth.controller.ts                            # Login, Register, OTP, Password Reset, Refresh, Telegram
│   ├── auth.module.ts
│   ├── auth.service.ts                               # Authentication business logic & password hashing
│   ├── otp.service.ts                                # Generates, stores, and validates OTP tokens
│   ├── refresh-token.service.ts                      # Issues & rotates cryptographically secure refresh tokens
│   ├── refresh-token-cleanup.service.ts              # Periodic cron job purging expired tokens
│   ├── telegram-auth.service.ts                      # Validates Telegram bot login hashes & links accounts
│   ├── user-blocked.exception.ts                     # Exception thrown when a banned user attempts authentication
│   ├── decorators/
│   │   ├── current-user.decorator.ts                 # Extracts authenticated user from request context
│   │   └── roles.decorator.ts                        # Enforces `@Roles(UserRole.ADMIN)` metadata
│   ├── guards/
│   │   ├── jwt-auth.guard.ts                         # Validates Bearer JWT header
│   │   ├── optional-jwt-auth.guard.ts                # Allows guest access while attaching user if authenticated
│   │   └── roles.guard.ts                            # Blocks non-admin users from admin endpoints
│   ├── strategies/
│   │   └── jwt.strategy.ts                           # Passport JWT verification strategy
│   └── dto/
│       ├── change-password.dto.ts
│       ├── device-meta.dto.ts
│       ├── login.dto.ts
│       ├── logout.dto.ts
│       ├── refresh-token.dto.ts
│       ├── register.dto.ts
│       ├── request-otp.dto.ts
│       ├── request-password-reset-otp.dto.ts
│       ├── request-register-otp.dto.ts
│       ├── reset-password.dto.ts
│       ├── session.dto.ts
│       ├── set-password.dto.ts
│       ├── telegram-auth.dto.ts
│       └── verify-otp.dto.ts
├── bingo-claims/
│   ├── bingo-claim-recovery.service.ts               # Recovers pending claims interrupted by server restarts
│   ├── bingo-claims.mapper.ts                        # Formats claim responses and prize split entities
│   ├── bingo-claims.module.ts
│   ├── bingo-claims.select.ts                        # Optimized Prisma query projection objects
│   ├── bingo-claims.service.ts                       # High-concurrency claim verification & atomic prize payout
│   ├── completed-patterns.mapper.ts                  # Serializes matched board patterns
│   ├── force-big-game-tickets.util.ts                # Grants Big Game ticket prizes on special pattern hits
│   ├── prize-split.util.ts                           # Computes exact ETB shares for simultaneous winners
│   ├── winner-window-finalizer.service.ts            # Closes WINNER_WINDOW countdown and finalizes session
│   ├── winning-ball.util.ts                          # Identifies the exact called ball triggering Bingo
│   └── dto/
│       ├── bingo-claim-source.ts                     # Enum: MANUAL vs AUTO_BINGO
│       ├── create-bingo-claim.dto.ts
│       └── reject-bingo-claim.dto.ts
├── called-numbers/
│   ├── called-numbers.mapper.ts                      # Maps called ball records
│   ├── called-numbers.module.ts
│   ├── called-numbers.select.ts
│   └── called-numbers.service.ts                     # RNG 1-75 ball generator with monotonic sequence numbering
├── cartelas/
│   ├── cartelas-prefix.util.ts                       # Generates cartela code prefixes
│   ├── cartelas.controller.ts                        # Serves 5x5 numbers catalog & individual cartela layouts
│   ├── cartelas.json                                 # Static pre-generated cartela matrix dataset
│   ├── cartelas.mapper.ts
│   ├── cartelas.module.ts
│   ├── cartelas.select.ts
│   ├── cartelas.service.ts                           # Fast retrieval of cartela boards and pagination
│   ├── seed-cartelas.ts                              # Seeds cartela numbers matrix into database
│   └── dto/
│       ├── get-cartela-board-query.dto.ts
│       └── get-cartela-catalog-query.dto.ts
├── common/
│   ├── common.module.ts
│   ├── decorators/
│   │   └── skip-app-throttlers.decorator.ts          # Bypasses rate limits on high-frequency internal calls
│   ├── dto/
│   │   └── pagination-query.dto.ts                   # Standard `page` and `limit` query parameters
│   ├── filters/
│   │   ├── http-exception.filter.ts                  # Global uniform JSON error response formatter
│   │   └── prisma-connectivity.util.ts               # Circuit breaker helper for DB disconnections
│   ├── interceptors/
│   │   ├── request-logging.interceptor.ts            # Detailed access logging with timing and status codes
│   │   └── success-response.interceptor.ts           # Standard `{ success: true, data: ... }` envelope wrapper
│   ├── performance/
│   │   ├── prisma-performance.extension.ts           # Intercepts and logs slow Prisma queries (>100ms)
│   │   └── request-performance.context.ts            # Tracks total HTTP transaction duration
│   ├── rate-limit/
│   │   ├── in-memory-rate-limiter.service.ts         # High-speed in-memory bucket limiter
│   │   └── user-action-rate-limit.service.ts         # Per-user debounce limiter (e.g. for claim button spam)
│   ├── services/
│   │   └── audit-log.service.ts                      # Writes sensitive admin actions to `AuditLog` table
│   ├── types/
│   │   └── jwt-payload.type.ts                       # Authenticated JWT token payload interface
│   └── utils/
│       ├── pagination.util.ts                        # Pagination math and metadata generator
│       └── phone.util.ts                             # Ethiopian phone number normalizer (09... to +251...)
├── config/
│   ├── cors.config.ts                                # Dynamic regex-based origin checker for web & mobile
│   └── env.validation.ts                             # Joi validation schema for environment variables
├── deposit-approval-config/
│   ├── deposit-approval-config.module.ts
│   ├── deposit-approval-config.service.ts            # Manages deposit approval rules (Auto vs Manual vs Local)
│   ├── deposit-approval-config.types.ts
│   ├── telebirr-local-receipt.validator.ts           # Validates Telebirr receipt text syntax & checksums
│   ├── telebirr-receipt-fetch.service.ts             # Scrapes receipt proof from Telebirr web receipt URL
│   ├── telebirr-receipt-html.parser.ts               # Parses scraped HTML receipt details
│   └── dto/update-deposit-approval-config.dto.ts
├── deposits/
│   ├── deposit-transaction-reference.ts              # Sanitizes and formats deposit reference codes
│   ├── deposit-verification-attempt.constants.ts
│   ├── deposit-verification.errors.ts
│   ├── deposit-verification.observability.ts         # Metrics counter for deposit verification success/failure
│   ├── deposits.controller.ts                        # Submit deposit, check reference, get verification attempts
│   ├── deposits.mapper.ts
│   ├── deposits.module.ts
│   ├── deposits.select.ts
│   ├── deposits.service.ts                           # Atomic deposit creation, ledger logging, and approvals
│   ├── telebirr-deposit.messages.ts
│   └── dto/
│       ├── admin-deposits-query.dto.ts
│       ├── approve-deposit.dto.ts
│       ├── check-deposit-reference.dto.ts
│       ├── create-deposit.dto.ts
│       ├── pending-deposit-verification.response.ts
│       ├── reject-deposit.dto.ts
│       ├── telebirr-client-receipt.dto.ts
│       └── telebirr-receipt-parse-status.enum.ts
├── game-engine/
│   ├── game-engine.module.ts
│   └── game-engine.service.ts                        # Coordinates state changes: NEXT -> READY -> PLAYING
├── game-rules/
│   ├── game-rule-evaluation.service.ts               # Evaluates winning conditions on 5x5 boards
│   ├── game-rule-legacy-cleanup.ts
│   ├── game-rule.seed-data.ts                        # Standard definitions for all 30+ bingo rules
│   ├── game-rules.module.ts
│   ├── game-rules.service.ts                         # Serves active rules to game sessions
│   ├── seed-game-rules.ts                            # Database seeder for game rules
│   ├── combo/
│   │   ├── base-pattern-generator.ts                 # Algorithmic pattern generator
│   │   ├── combo-pattern-definitions.ts              # Multi-pattern definitions (e.g. Line + Corners)
│   │   ├── combo-rule.evaluator.ts                   # Evaluates composite rules
│   │   ├── combo-solver.ts                           # Fast solver verifying rule completion
│   │   ├── combo.types.ts
│   │   ├── extended-pattern-definitions.ts           # Letter patterns (H, X, T, Plus, Box)
│   │   └── half-house-pattern-definitions.ts         # Top/Bottom half, Left/Right half patterns
│   ├── evaluators/
│   │   ├── board.util.ts                             # 5x5 grid index math helpers
│   │   ├── columns-rule.evaluator.ts                 # Vertical column evaluator
│   │   ├── diagonal-rule.evaluator.ts                # Diagonal (top-left to bottom-right, etc.) evaluator
│   │   ├── full-house-rule.evaluator.ts              # All 25 cells marked evaluator
│   │   ├── half-house-rule.evaluator.ts              # 12-cell half-house evaluator
│   │   ├── line-rule.evaluator.ts                    # Any line evaluator
│   │   ├── pattern-display.util.ts                   # Formats pattern for UI preview
│   │   ├── pattern-rule.evaluator.ts                 # Specific geometric pattern evaluator
│   │   └── rows-rule.evaluator.ts                    # Horizontal row evaluator
│   ├── interfaces/game-rule-evaluator.interface.ts
│   └── patterns/
│       ├── game-rule.patterns.ts
│       └── pattern.types.ts
├── game-timing-config/
│   ├── game-timing-config.defaults.ts                # Default countdowns (Ready: 10s, Call: 3s, Winner: 15s)
│   ├── game-timing-config.module.ts
│   ├── game-timing-config.service.ts                 # Manages real-time timing parameters
│   ├── game-timing-config.types.ts
│   └── dto/update-game-timing-config.dto.ts
├── games/
│   ├── auto-call.service.ts                          # Background interval calling numbers automatically
│   ├── auto-ready-countdown-repair.service.ts        # Self-healing worker repairing stuck READY countdowns
│   ├── big-game-round.module.ts
│   ├── big-game-round.service.ts                     # Orchestrates daily Big Game multi-round phases
│   ├── big-game-ticket.module.ts
│   ├── big-game-ticket.service.ts                    # Manages Big Game ticket allowances & grants
│   ├── cartela-reservation-expirer.service.ts        # Cron worker releasing expired cartela reservations
│   ├── chain-round.module.ts
│   ├── chain-round.service.ts                        # Controls multi-round Chain Game rules & inter-round breaks
│   ├── chain-round.util.ts
│   ├── game-auto-start-scheduler.service.ts          # Starts game when countdown expires or min players reached
│   ├── game-category.util.ts                         # Normalizes NORMAL, BONUS, BIG_GAME, CHAIN_GAME
│   ├── game-data-retention.service.ts                # Purges or archives historical game data
│   ├── game-lifecycle-debug-logger.service.ts        # Detailed state transition tracer
│   ├── game-lifecycle.service.ts                     # Core status progression logic
│   ├── game-operation-invariants.service.ts          # Validates active game state consistency
│   ├── game-operation-repair.service.ts              # Automatically recovers crashed or stuck sessions
│   ├── game-queue-diversity.ts                       # Ensures distinct game rules in sequential queue
│   ├── game-queue.service.ts                         # Manages FIFO order of upcoming game slots
│   ├── game-row-lock.ts                              # Explicit PostgreSQL `FOR UPDATE` lock helper
│   ├── game-status.rules.ts                          # State machine transition rules
│   ├── game-transition-lock.ts                       # In-memory mutex preventing concurrent status shifts
│   ├── games.controller.ts                           # Live game status, operations snapshot, registration, claims
│   ├── games.mapper.ts
│   ├── games.module.ts
│   ├── games.operation-mode.ts                       # MANUAL vs AUTO operation mode logic
│   ├── games.select.ts                               # Optimized Prisma projection selectors
│   ├── games.service.ts                              # Primary game creation, registration & session retrieval
│   ├── normal-economics.util.ts                      # Calculates prize pot, company commission, house share
│   ├── operations-cache.module.ts
│   ├── operations-cache.service.ts                   # In-memory cache for high-frequency operations snapshots
│   ├── post-game-registration-opener.module.ts
│   ├── post-game-registration-opener.service.ts      # Immediately opens registration on next slot after game ends
│   ├── registration-limits.ts                        # Enforces max 100/200/500 cartelas per session
│   ├── registration-payment.util.ts                  # Debits wallet or consumes free bonus cartelas
│   ├── registration-state-cache.service.ts           # Caches public registration counts and progress
│   ├── registration-state.builder.ts                 # Constructs client registration state DTO
│   ├── round-game-rule.util.ts                       # Maps rule to specific round in Chain Game
│   ├── session-outcome-summary.builder.ts            # Builds completed session payout summaries
│   ├── session-winner-results.builder.ts             # Formats verified winners and pattern data
│   └── dto/
│       ├── bulk-register-cartelas.dto.ts
│       ├── bulk-reserve-cartelas.dto.ts
│       ├── clear-queue-response.dto.ts
│       ├── create-game.dto.ts
│       ├── extend-chain-round-pause.dto.ts
│       ├── game-operations.dto.ts
│       ├── move-game-queue.dto.ts
│       ├── register-cartela.dto.ts
│       ├── registration-state-query.dto.ts
│       ├── reserve-cartela.dto.ts
│       ├── start-session.dto.ts
│       ├── update-big-game-schedule.dto.ts
│       ├── update-game-status.dto.ts
│       ├── update-slot-economics.dto.ts
│       ├── update-slot-entry-fee.dto.ts
│       └── update-slot-operation-mode.dto.ts
├── health/
│   ├── health.controller.ts                          # Liveness & readiness probes (`/health`)
│   ├── health.module.ts
│   └── health.service.ts                             # Checks PostgreSQL connectivity and Redis connection
├── leaderboard/
│   ├── leaderboard-cache.service.ts                  # Caches top winners to avoid repeated heavy queries
│   ├── leaderboard-period.util.ts                    # Time range calculator (Daily, Weekly, All-Time)
│   ├── leaderboard.mapper.ts
│   ├── leaderboard.module.ts
│   ├── leaderboard.service.ts                        # Computes top cartela winners and total ETB won
│   └── dto/leaderboard-query.dto.ts
├── notification-config/
│   ├── notification-config.defaults.ts
│   ├── notification-config.module.ts
│   ├── notification-config.service.ts                # Configures push delivery policies
│   ├── notification-config.types.ts
│   └── dto/update-notification-config.dto.ts
├── notifications/
│   ├── big-game-push-reminder.service.ts             # Sends push reminders 15m & 5m before Big Game
│   ├── firebase-admin.provider.ts                    # Initializes Firebase Admin SDK
│   ├── firebase-push-error.ts                        # Categorizes invalid/unregistered FCM device tokens
│   ├── game-push-notifications.service.ts            # Broadcasts push notifications for game events
│   ├── notifications.controller.ts                   # Registers FCM device tokens, fetches broadcast alerts
│   ├── notifications.module.ts
│   ├── notifications.service.ts                      # Dispatches FCM push payloads
│   ├── push-delivery-guard.service.ts                # Checks player push preference before dispatching
│   ├── push-notification-messages.ts                 # Localized push notification templates
│   ├── push-rate-policy.ts                           # Throttles push volume per device
│   ├── dto/
│   │   ├── register-device.dto.ts
│   │   └── unregister-device.dto.ts
│   ├── types/
│   │   ├── app-push-broadcast-summary.type.ts
│   │   └── push-category.type.ts
│   └── utils/
│       ├── map-with-concurrency.ts                   # Concurrency pool helper for parallel push dispatch
│       └── map-with-concurrency.spec.ts
├── observability/
│   ├── internal-network.util.ts                      # Restricts Prometheus metrics to internal IPs
│   ├── metrics.controller.ts                         # Serves Prometheus metrics on `/metrics`
│   ├── observability.module.ts
│   ├── observability.service.ts                      # Records active sockets, query latencies, claim counts
│   └── request-context.service.ts                    # Propagates correlation IDs across async execution
├── prisma/
│   ├── database-url.util.ts                          # Configures connection pool limits & SSL params
│   ├── prisma.module.ts
│   └── prisma.service.ts                             # Connects to PostgreSQL with auto-retry and shutdown hooks
├── realtime/
│   ├── helpers/game-operation.helper.ts
│   ├── realtime.gateway.ts                           # Socket.IO Gateway on `/realtime` namespace
│   ├── realtime.module.ts
│   ├── realtime.service.ts                           # Broadcasts events to session, slot, user, or admin rooms
│   ├── redis-io.adapter.ts                           # Redis-backed distributed Socket.IO adapter
│   ├── session-cartelas-updated-batcher.ts           # Coalesces cartela updates into 75ms batched emits
│   ├── socket-io-redis.module.ts
│   ├── socket-io-redis.service.ts                    # Manages Redis pub/sub connections for clustering
│   └── types/
│       ├── game-operation-payload.type.ts
│       └── realtime-user.type.ts
├── seed/                                             # Seeding CLI tools and scripts
│   ├── cartela-seed-filter.ts
│   ├── cartela-seed-loader.ts
│   ├── create-seed-prisma-client.ts
│   ├── production-data-wipe.ts
│   ├── production-seed.ts
│   ├── seed-admins.cli.ts
│   ├── seed-admins.ts
│   ├── seed-app-display-config.ts
│   ├── seed-cartelas.ts
│   ├── seed-data-paths.ts
│   ├── seed-game-rules-from-json.ts
│   ├── seed-game-timing-config.ts
│   ├── seed-notification-config.ts
│   └── seed-timing.cli.ts
├── sms/
│   ├── sms.controller.ts                             # Callback receiver for GeezSMS delivery reports
│   ├── sms.errors.ts
│   ├── sms.module.ts
│   ├── sms.service.ts                                # Sends SMS verification codes
│   └── providers/
│       ├── geezsms.provider.ts                       # HTTP client for GeezSMS provider
│       └── geezsms.provider.spec.ts
├── support/
│   ├── support.controller.ts                         # Customer support ticket endpoints for players & admin
│   ├── support.mapper.ts
│   ├── support.module.ts
│   ├── support.select.ts
│   ├── support.service.ts                            # Ticket creation, unread tracking, and admin replies
│   └── dto/
│       ├── admin-create-support-message.dto.ts
│       ├── create-support-message.dto.ts
│       ├── reply-support-message.dto.ts
│       └── support-messages-query.dto.ts
├── users/
│   ├── user-feature-settings.util.ts
│   ├── users-admin-feature-grants.service.ts         # Admin feature grant toggles (auto-mark, auto-bingo)
│   ├── users-bulk-feature-grants.service.ts          # Bulk feature grants for player cohorts
│   ├── users-feature-settings.service.ts             # Player feature settings management
│   ├── users.controller.ts                           # Player profile, feature settings, push preferences
│   ├── users.mapper.ts
│   ├── users.module.ts
│   ├── users.select.ts
│   ├── users.service.ts                              # User queries, status changes, ban enforcement
│   └── dto/
│       ├── admin-devices-query.dto.ts
│       ├── admin-user-wallet-transactions-query.dto.ts
│       ├── admin-users-query.dto.ts
│       ├── bulk-admin-user-feature-grants.dto.ts
│       ├── update-admin-user-feature-grants.dto.ts
│       ├── update-admin-user-status.dto.ts
│       ├── update-feature-settings.dto.ts
│       └── update-notification-preferences.dto.ts
├── verify-et/
│   ├── verify-et.client.ts                           # HTTP client interacting with Verify-ET API
│   ├── verify-et.constants.ts
│   ├── verify-et.module.ts
│   ├── verify-et.service.ts                          # Automated bank & telebirr transaction verification
│   └── verify-et.types.ts
├── wallet/
│   ├── wallet.controller.ts                          # `/wallet/me` and `/wallet/transactions/me`
│   ├── wallet.mapper.ts
│   ├── wallet.module.ts
│   ├── wallet.select.ts
│   └── wallet.service.ts                             # Wallet balance calculations and transaction ledger
└── withdrawals/
    ├── withdrawals.controller.ts                     # Player withdrawal creation and history
    ├── withdrawals.mapper.ts
    ├── withdrawals.module.ts
    ├── withdrawals.select.ts
    ├── withdrawals.service.ts                        # Withdrawal request validation, approval, and payouts
    └── dto/
        ├── admin-withdrawals-query.dto.ts
        ├── approve-withdrawal.dto.ts
        ├── create-withdrawal.dto.ts
        ├── mark-paid-withdrawal.dto.ts
        └── reject-withdrawal.dto.ts
```

---

## 3. Exhaustive API Routes & Controller Catalog

The backend exposes **100+ endpoints** structured with standard JSON envelopes `{ success: true, data: ... }`.

### A. Authentication (`/api/auth`) — `AuthController`
| Method | Path | Auth / Guard | Body / Query DTO | Description |
|:---|:---|:---|:---|:---|
| `POST` | `/api/auth/request-otp` | Public (Throttled) | `RequestOtpDto` | Requests general verification OTP |
| `POST` | `/api/auth/verify-otp` | Public (Throttled) | `VerifyOtpDto` | Verifies submitted OTP code |
| `POST` | `/api/auth/request-register-otp` | Public (Throttled) | `RequestRegisterOtpDto` | Sends registration SMS verification code |
| `POST` | `/api/auth/register` | Public (Throttled) | `RegisterDto` | Creates player account & issues JWT tokens |
| `POST` | `/api/auth/login` | Public (Throttled) | `LoginDto` | Authenticates with phone & password |
| `POST` | `/api/auth/request-password-reset-otp`| Public | `RequestPasswordResetOtpDto`| Sends password recovery OTP |
| `POST` | `/api/auth/reset-password` | Public | `ResetPasswordDto` | Resets password after OTP validation |
| `POST` | `/api/auth/change-password` | JWT Player | `ChangePasswordDto` | Updates password for authenticated user |
| `POST` | `/api/auth/request-set-password-otp` | JWT Player | - | Requests OTP to set initial password |
| `POST` | `/api/auth/set-password` | JWT Player | `SetPasswordDto` | Sets initial password |
| `GET` | `/api/auth/sessions` | JWT Player | - | Lists active device sessions |
| `DELETE`| `/api/auth/sessions/:id` | JWT Player | - | Revokes a specific login session |
| `POST` | `/api/auth/sessions/logout-others`| JWT Player | - | Logs out all other active devices |
| `POST` | `/api/auth/telegram/start` | Public | - | Initiates Telegram bot auth challenge |
| `POST` | `/api/auth/telegram/request-otp` | Public | - | Requests phone OTP for Telegram account |
| `POST` | `/api/auth/telegram/complete` | Public | `TelegramAuthDto` | Completes Telegram login & issues JWT |
| `POST` | `/api/auth/telegram/link` | JWT Player | `TelegramAuthDto` | Links Telegram ID to existing account |
| `POST` | `/api/auth/telegram/unlink` | JWT Player | - | Unlinks Telegram ID |
| `GET` | `/api/auth/telegram/widget` | Public | - | Serves Telegram widget configuration |
| `GET` | `/api/auth/telegram/callback` | Public | - | Webhook callback for Telegram auth |
| `POST` | `/api/auth/refresh` | Public | `RefreshTokenDto` | Rotates refresh token & issues new JWT |
| `POST` | `/api/auth/logout` | JWT Player | `LogoutDto` | Invalidates active refresh token |

### B. Live Games & Operations (`/api/games`) — `GamesController`
| Method | Path | Auth / Guard | Body / Query DTO | Description |
|:---|:---|:---|:---|:---|
| `GET` | `/api/games` | Optional JWT | `PaginationQueryDto` | Lists active and upcoming game sessions |
| `GET` | `/api/games/time-config` | Public | - | Returns current countdown & ball call timings |
| `GET` | `/api/games/leaderboard/cartela-wins`| Public | `LeaderboardQueryDto`| Returns top players with cartela wins |
| `GET` | `/api/games/current/live` | Optional JWT | - | Returns currently active live game session |
| `GET` | `/api/games/operations/current` | Optional JWT | - | Realtime operational snapshot of active slot |
| `GET` | `/api/games/big-game/current` | Optional JWT | - | Returns current scheduled Big Game details |
| `GET` | `/api/games/slots/:id` | Optional JWT | - | Returns slot config, economics, and queue |
| `GET` | `/api/games/sessions/:id` | Optional JWT | - | Detailed session status and rule info |
| `GET` | `/api/games/sessions/:id/winner-results` | Optional JWT | - | Public winners list with prizes & patterns |
| `GET` | `/api/games/sessions/:id/round-winners` | Optional JWT | - | Winners list of a specific round |
| `GET` | `/api/games/slots/:slotId/big-game/round-winners`| Optional JWT| - | Round winners of a multi-round Big Game |
| `GET` | `/api/games/sessions/:id/winner-result`| Optional JWT | - | Single winner outcome entity |
| `GET` | `/api/games/sessions/:id/chain-rounds`| Optional JWT | - | Rules and prize splits for Chain Game |
| `GET` | `/api/games/sessions/:id/called-numbers`| Optional JWT | - | Ordered array of all called numbers |
| `GET` | `/api/games/sessions/:id/registration-state`| Optional JWT| `RegistrationStateQueryDto`| Registered cartela count and status |
| `POST` | `/api/games/sessions/:id/register-cartela`| JWT Player | `RegisterCartelaDto` | Registers a single cartela by ID |
| `POST` | `/api/games/slots/:slotId/register-cartela`| JWT Player| `RegisterCartelaDto` | Registers cartela directly to slot |
| `POST` | `/api/games/slots/:slotId/register-cartelas-bulk`| JWT Player| `BulkRegisterCartelasDto`| Atomic bulk buy of multiple cartelas |
| `POST` | `/api/games/sessions/:id/reserve-cartelas-bulk`| JWT Player| `BulkReserveCartelasDto`| Temporarily holds cards with countdown |
| `POST` | `/api/games/slots/:slotId/reserve-cartelas-bulk`| JWT Player| `BulkReserveCartelasDto`| Holds cards on specific slot |
| `POST` | `/api/games/sessions/:id/cartelas/:cartelaId/reserve`| JWT Player| `ReserveCartelaDto`| Holds single cartela |
| `POST` | `/api/games/slots/:slotId/cartelas/:cartelaId/reserve`| JWT Player| `ReserveCartelaDto`| Holds single cartela on slot |
| `POST` | `/api/games/reservations/:id/confirm`| JWT Player | - | Confirms reservation & debits wallet |
| `POST` | `/api/games/reservations/:id/cancel`| JWT Player | - | Releases hold on reserved cartela |
| `POST` | `/api/games/sessions/:id/bingo` | JWT Player | `CreateBingoClaimDto` | Submits Bingo claim (Manual/Auto) |
| `GET` | `/api/games/sessions/:id/bingo-claims/:claimAttemptId`| JWT Player| - | Polls result of submitted claim attempt |
| `GET` | `/api/games/sessions/:id/my-cartelas`| JWT Player | - | Returns user's registered cartelas with boards |
| `GET` | `/api/games/my-history` | JWT Player | `PaginationQueryDto` | Personal game participation history |
| `GET` | `/api/games/history` | Optional JWT | `PaginationQueryDto` | Global public past games history |

### C. Deposits & Verification (`/api/deposits`) — `DepositsController`
| Method | Path | Auth / Guard | Body / Query DTO | Description |
|:---|:---|:---|:---|:---|
| `POST` | `/api/deposits` | JWT Player | `CreateDepositDto` | Submits deposit with transaction reference |
| `POST` | `/api/deposits/check-ref` | JWT Player | `CheckDepositReferenceDto`| Pre-checks reference code uniqueness |
| `GET` | `/api/deposits/config` | Optional JWT | - | Returns active CBE & Telebirr account numbers |
| `GET` | `/api/deposits/me` | JWT Player | `PaginationQueryDto` | User's personal deposit history |
| `GET` | `/api/deposits/verification-attempts/active`| JWT Player| - | Returns ongoing automated verification task |
| `POST` | `/api/deposits/verification-attempts/:attemptId/check`| JWT Player| - | Triggers re-check of verification attempt |
| `POST` | `/api/deposits/verification-attempts/:attemptId/cancel`| JWT Player| - | Cancels pending verification attempt |

### D. Wallet & Withdrawals (`/api/wallet`, `/api/withdrawals`)
| Method | Path | Auth / Guard | Body / Query DTO | Description |
|:---|:---|:---|:---|:---|
| `GET` | `/api/wallet/me` | JWT Player | - | Returns main, bonus, and locked balances |
| `GET` | `/api/wallet/transactions/me` | JWT Player | `PaginationQueryDto` | Financial transaction ledger |
| `POST` | `/api/withdrawals` | JWT Player | `CreateWithdrawalDto` | Submits withdrawal request |
| `GET` | `/api/withdrawals/me` | JWT Player | `PaginationQueryDto` | Personal withdrawal requests history |

### E. Cartelas & Boards (`/api/cartelas`) — `CartelasController`
| Method | Path | Auth / Guard | Body / Query DTO | Description |
|:---|:---|:---|:---|:---|
| `GET` | `/api/cartelas` | Optional JWT | `GetCartelaCatalogQueryDto`| Returns paginated list of cartela IDs |
| `GET` | `/api/cartelas/:cartelaId/board` | Optional JWT | `GetCartelaBoardQueryDto` | Returns 5x5 numbers matrix for card |

### F. Users & Settings (`/api/users`) — `UsersController`
| Method | Path | Auth / Guard | Body / Query DTO | Description |
|:---|:---|:---|:---|:---|
| `GET` | `/api/users/me` | JWT Player | - | Current user profile details |
| `GET` | `/api/users/me/feature-settings` | JWT Player | - | User feature settings (auto-mark, auto-bingo) |
| `PATCH` | `/api/users/me/feature-settings` | JWT Player | `UpdateFeatureSettingsDto`| Updates auto-mark / auto-bingo toggles |
| `PATCH` | `/api/users/me/notification-preferences`| JWT Player| `UpdateNotificationPreferencesDto`| Updates game push notification mode |

### G. Notifications & Versioning (`/api/notifications`, `/api/app-version`)
| Method | Path | Auth / Guard | Body / Query DTO | Description |
|:---|:---|:---|:---|:---|
| `POST` | `/api/notifications/register-device` | JWT Player | `RegisterDeviceDto` | Saves FCM device token for player |
| `DELETE`| `/api/notifications/register-device` | JWT Player | `UnregisterDeviceDto` | Removes FCM device token |
| `GET` | `/api/notifications/broadcasts` | Optional JWT | - | Returns active system broadcast alerts |
| `DELETE`| `/api/notifications/broadcasts/:id` | JWT Player | - | Dismisses broadcast banner for user |
| `GET` | `/api/app-version/android` | Public | - | Latest Android version & force-update requirements |

### H. Support & Helpdesk (`/api/support`) — `SupportController`
| Method | Path | Auth / Guard | Body / Query DTO | Description |
|:---|:---|:---|:---|:---|
| `POST` | `/api/support/messages` | JWT Player | `CreateSupportMessageDto` | Submits customer feedback or inquiry |
| `GET` | `/api/support/messages/me/unread-count`| JWT Player | - | Returns number of unread admin replies |
| `POST` | `/api/support/messages/me/mark-seen`| JWT Player | - | Marks admin replies as seen |
| `GET` | `/api/support/messages/me` | JWT Player | `PaginationQueryDto` | Returns user's ticket thread |

### I. System & Health (`/api/health`, `/api/metrics`, `/api/sms`)
| Method | Path | Auth / Guard | Body / Query DTO | Description |
|:---|:---|:---|:---|:---|
| `GET` | `/api/health` | Public | - | PostgreSQL & Redis health check |
| `GET` | `/api/metrics` | Internal IP Only | - | Prometheus observability metrics |
| `POST` | `/api/sms/geezsms/callback` | Public | - | Webhook for SMS delivery updates |

### J. Complete Admin Portal Endpoints (`/api/admin`) — `AdminController`
All endpoints below require `@UseGuards(JwtAuthGuard, RolesGuard)` and `@Roles(UserRole.ADMIN)`:
- **Credentials & Auth**:
  - `POST /api/admin/change-password`: Changes admin credentials.
- **Game Slots & Queue Management**:
  - `GET /api/admin/slots`: Lists all game slots with current status.
  - `POST /api/admin/slots`: Creates a new game slot.
  - `PATCH /api/admin/slots/:id/operation-mode`: Toggles MANUAL vs AUTO mode.
  - `PATCH /api/admin/slots/:id/entry-fee`: Updates entry fee (e.g. 10, 20, 50 ETB).
  - `PATCH /api/admin/slots/:id/economics`: Configures company cut percentage & bonus cartela rules.
  - `PATCH /api/admin/slots/:id/status`: Updates slot status.
  - `POST /api/admin/slots/reorder`: Reorders queue positions.
  - `POST /api/admin/slots/clear-queue`: Clears waiting game queue.
  - `POST /api/admin/slots/:id/start`: Manually forces session start.
- **Big Game & Chain Game Controls**:
  - `PATCH /api/admin/slots/:id/big-game-schedule`: Updates schedule time.
  - `POST /api/admin/slots/:id/big-game/start-next-round`: Advances to next round.
  - `POST /api/admin/slots/:id/big-game/start-now`: Immediately starts Big Game.
  - `POST /api/admin/slots/:id/chain-game/continue-now`: Skips break countdown.
  - `POST /api/admin/slots/:id/chain-game/extend-pause`: Extends inter-round break.
- **Live Session Controls & Calling**:
  - `GET /api/admin/sessions/:id/registered-players`: Lists all registered cartelas & players.
  - `PATCH /api/admin/sessions/:id/cancel`: Cancels session & refunds all entry fees.
  - `PATCH /api/admin/sessions/:id/finalize-winner-window`: Forces winner window close.
  - `POST /api/admin/sessions/:id/call-number`: Manually calls a specific ball number.
  - `POST /api/admin/sessions/:id/auto-call/start`: Starts auto-caller loop.
  - `POST /api/admin/sessions/:id/auto-call/stop`: Stops auto-caller loop.
  - `GET /api/admin/sessions/:id/bingo-attempts`: Lists all claim attempts in session.
- **Claims & Approvals**:
  - `GET /api/admin/bingo-claims`: Lists recent bingo claims.
  - `PATCH /api/admin/bingo-claims/:id/approve`: Manually validates claim.
  - `PATCH /api/admin/bingo-claims/:id/reject`: Manually rejects claim.
- **Deposit Approvals & Management**:
  - `GET /api/admin/deposits/pending-count`: Returns pending deposit count.
  - `GET /api/admin/deposits`: Paginated deposit requests.
  - `PATCH /api/admin/deposits/:id/approve`: Manually approves deposit & credits wallet.
  - `PATCH /api/admin/deposits/:id/reject`: Rejects deposit with reason.
- **Withdrawal Approvals & Payouts**:
  - `GET /api/admin/withdrawals/pending-count`: Returns pending withdrawal count.
  - `GET /api/admin/withdrawals`: Paginated withdrawal requests.
  - `PATCH /api/admin/withdrawals/:id/approve`: Approves withdrawal.
  - `PATCH /api/admin/withdrawals/:id/reject`: Rejects withdrawal & refunds wallet.
  - `PATCH /api/admin/withdrawals/:id/mark-paid`: Marks payout completed.
- **User & Device Management**:
  - `GET /api/admin/users`: Search and paginate players.
  - `GET /api/admin/users/:id`: Detailed player info.
  - `GET /api/admin/users/:id/auth-details`: User session and auth logs.
  - `PATCH /api/admin/users/:id/status`: Bans or activates player account.
  - `PATCH /api/admin/users/:id/feature-grants`: Grants/revokes auto-mark or auto-bingo.
  - `POST /api/admin/users/feature-grants/bulk`: Bulk grants features to player lists.
  - `GET /api/admin/users/:id/financial-history`: Lifetime deposits, withdrawals, and margins.
  - `GET /api/admin/users/:id/game-history`: Complete game participation log.
  - `GET /api/admin/users/:id/wallet-transactions`: Raw ledger transactions.
  - `GET /api/admin/devices`: Device tracking & fraud prevention list.
- **System Configuration & Broadcasts**:
  - `GET /api/admin/time-config` & `PATCH /api/admin/time-config`: Dynamic countdowns.
  - `GET /api/admin/deposit-config` & `PATCH /api/admin/deposit-config`: Settlement account numbers.
  - `GET /api/admin/display-config` & `PATCH /api/admin/display-config`: App banners.
  - `GET /api/admin/notification-config` & `PATCH /api/admin/notification-config`: Push settings.
  - `POST /api/admin/broadcasts`, `GET /api/admin/broadcasts`, `DELETE /api/admin/broadcasts/:id`.
- **Financial Reports & Expenses**:
  - `GET /api/admin/reports/overview`: Executive summary of revenue, prizes, and profit.
  - `GET /api/admin/reports/financial`: Detailed accounting report.
  - `GET /api/admin/reports/games`: Session margin analysis.
  - `POST /api/admin/expenses` & `GET /api/admin/expenses`: Operational expense tracking.
- **Helpdesk & Support**:
  - `GET /api/admin/support/messages/open-count`: Open ticket count.
  - `GET /api/admin/support/messages`: Paginated tickets.
  - `GET /api/admin/support/messages/:id`: Single ticket thread.
  - `PATCH /api/admin/support/messages/:id`: Reply to ticket and close/resolve.

---

## 4. Services & Core Business Logic Architecture

### A. Core Game Execution & Life-Cycle Services
1. **`GamesService`**: Master coordinator for creating game sessions, managing queues, slot economics, and session registration.
2. **`GameLifecycleService`**: Governs strict state transitions: `NEXT` -> `READY` -> `PLAYING` -> `WINNER_WINDOW` -> `FINISHED`.
3. **`GameEngineService`**: Orchestrates state triggers and event notifications across the lifecycle.
4. **`AutoCallService`**: Interval timer calling random balls every N seconds while game is `PLAYING`.
5. **`OperationsCacheService`**: High-performance in-memory cache keeping current game operations pre-computed for fast HTTP reads.
6. **`RegistrationStateCacheService`**: High-speed cache for registered player and cartela counts.
7. **`ChainRoundService`**: Coordinates multi-round Chain Games, tracking carrying cartelas, accumulated prize pots, and inter-round pauses.
8. **`BigGameRoundService` & `BigGameTicketService`**: Manages scheduled high-stakes daily Big Games and player ticket balances.

### B. Verification, Claim & Rule Evaluation Services
1. **`BingoClaimsService`**: Concurrent claim processing engine. Validates player cartela against active rules, verifies the winning ball, applies row locks, and calculates prize splits.
2. **`WinnerWindowFinalizerService`**: Closes the 15-second multi-winner window, distributes prizes to verified winners, marks session `FINISHED`, and triggers next game registration.
3. **`GameRulesService` & Evaluators**: Evaluates combinations across 30+ game rule patterns (Line, Diagonal, Full House, Shapes, Half House, Combo rules).
4. **`CalledNumbersService`**: Monotonic 1–75 ball generator ensuring zero duplicate calls per session.

### C. Financial & Verification Services
1. **`WalletService`**: Atomically credits and debits user balances. Maintains immutable `WalletTransaction` audit records.
2. **`DepositsService`**: Coordinates deposit submission, local receipt validation, and manual admin approvals.
3. **`VerifyEtService` & `VerifyEtClient`**: Interacts with third-party payment APIs for automated transaction verification.
4. **`TelebirrReceiptFetchService` & `TelebirrReceiptHtmlParser`**: Scrapes and parses web-based Telebirr receipt URLs to verify deposits without human intervention.
5. **`WithdrawalsService`**: Validates withdrawal requests against available balances, handles approval workflows, and executes payouts.

### D. Realtime, Notifications & Support Services
1. **`RealtimeService`**: High-level Socket.IO emitter targeting session rooms, personal user channels, or public lobbies.
2. **`SocketIoRedisService`**: Manages distributed Redis pub/sub streams.
3. **`NotificationsService`**: Dispatches push notifications via Firebase Admin SDK with concurrency limits.
4. **`BigGamePushReminderService`**: Automated scheduler alerting players before scheduled events.
5. **`SupportService`**: Handles player tickets and real-time unread counter synchronizations.

---

## 5. Database Persistence, Models & Concurrency Locking

The system uses **PostgreSQL** managed by **Prisma ORM**.

### A. Catalog of 34 Prisma Database Models
1. `User`: Player and Admin accounts, statuses, feature grant flags, Telegram link.
2. `TelegramAuthChallenge`: Temporary security challenge codes for Telegram authentication.
3. `PushDevice`: Registered FCM tokens mapped to user and device metadata.
4. `PushDeliveryLog`: Delivery history and delivery latency metrics for push notifications.
5. `OtpChallenge`: SMS OTP verification challenges with rate-limiting counters.
6. `SmsDeliveryLog`: Audit log of all SMS messages dispatched.
7. `Wallet`: Balance breakdown (playable `balance`, `bonusCartelaBalance`, `lockedBalance`).
8. `DeviceWelcomeBonusGrant`: Prevents multiple welcome bonus claims on the same physical device.
9. `WalletTransaction`: Immutable financial ledger records (DEPOSIT, WITHDRAW, GAME_ENTRY, PRIZE_WIN, etc.).
10. `BigGameTicketBalance`: Big Game ticket balance per player.
11. `BigGameTicketLedger`: Big Game ticket grant and spending transactions.
12. `Deposit`: Player deposit records, providers (TELEBIRR, CBE), reference codes, statuses.
13. `DepositApprovalConfig`: Configuration for auto/manual/local receipt approval rules.
14. `DepositVerificationAttempt`: Asynchronous verification attempt tracking third-party API polling.
15. `Withdrawal`: Payout requests, destination accounts, provider fees, statuses.
16. `GameRule`: Master definitions of winning patterns and rules.
17. `GameSlot`: Operational game slot (NORMAL, BONUS, BIG_GAME, CHAIN_GAME) and active queue.
18. `GameSession`: Live game instance, statuses (`NEXT` through `FINISHED`), entry fees, pot sizes.
19. `GameSessionRoundResult`: Per-round results in Chain Games.
20. `GameSessionRoundWinner`: Per-round winners in Chain Games.
21. `Cartela`: Master 5x5 numbers matrix for all 100/200/500 cartela numbers.
22. `GameCartelaReservation`: Temporary hold on cartelas with expiration timestamp.
23. `GameCartela`: Registered cartelas locked to a specific player and game session.
24. `CalledNumber`: Ordered sequence of balls called in a game session.
25. `BingoClaim`: Claim records, validity status, detected patterns, and payout share.
26. `Notification`: In-app notification records.
27. `AdminExpense`: Operational expense ledger entries.
28. `GameTimingConfig`: Dynamic countdowns and ball calling interval configs.
29. `AppDisplayConfig`: System branding banners and promotional text overrides.
30. `NotificationConfig`: Global push notification preferences.
31. `AuditLog`: Security audit log for admin operations.
32. `AdminBroadcast`: System-wide banner announcements.
33. `AdminBroadcastDismissal`: Tracks players who have dismissed specific broadcasts.
34. `PlayerSupportMessage`: Helpdesk tickets and reply threads.
35. `RefreshToken`: Hashed refresh tokens with device ID and expiry for JWT rotation.

### B. Concurrency & Locking Strategy
- **Row-Level Locks (`SELECT ... FOR UPDATE`)**: Implemented via `game-row-lock.ts` to prevent race conditions during cartela registration and claim evaluations.
- **Atomic Balance Debiting**: Wallet deductions occur inside `prisma.$transaction`, ensuring balance never drops below zero and eliminating double-registration.
- **In-Memory Transition Mutex (`GameTransitionLock`)**: Ensures status shifts (e.g. `PLAYING` -> `WINNER_WINDOW`) execute once and only once, even if multiple claims arrive simultaneously.
- **Operations Caching**: `OperationsCacheService` eliminates thousands of repetitive database queries during live active games by serving from memory.

---

## 6. Realtime WebSocket (Socket.IO & Redis) Architecture

- **Namespace**: `/realtime`
- **Path**: `/socket.io`
- **Adapter**: `@socket.io/redis-adapter` for multi-instance scaling.

### Room Hierarchy
```
games:public                                   # Public lobby (game countdowns, operations snapshots)
session:<sessionId>                            # Active live game (ball calls, claim notices, winners)
slot:<slotId>                                  # Slot-level operational updates
user:<userId>                                  # Private channel (wallet updates, personal claim results)
admin                                          # Admin channel (live claim audits, deposit alerts)
```

### Server-to-Client WebSocket Events Catalog
| Event | Room | Description |
|:---|:---|:---|
| `game:status_changed` | `session:<id>`, `games:public` | Game transitions to NEXT, READY, PLAYING, etc. |
| `game:operation_updated` | `session:<id>`, `slot:<id>` | Live slot status and registration metrics |
| `game:number_called` | `session:<id>` | Monotonic ball called event (number, letter, index) |
| `game:cartelas:updated`| `session:<id>` | Coalesced (75ms batched) registration updates |
| `game:cartelas:summary`| `session:<id>`, `games:public` | Registered card count & total prize pot |
| `game:claim_created` | `session:<id>`, `admin` | Notifies that a player called Bingo |
| `game:winner_window_started`| `session:<id>` | Starts 15s window for simultaneous winners |
| `game:winner_window_finalized`| `session:<id>`| Concludes game and lists verified winners |
| `game:finished` | `session:<id>`, `games:public` | Concludes session |
| `game:cancelled` | `session:<id>`, `games:public` | Cancels session and notifies refunds |
| `chain:round_started` | `session:<id>` | Begins new round in Chain Game |
| `chain:round_finished`| `session:<id>` | Concludes round in Chain Game |
| `chain:round_paused` | `session:<id>` | Starts inter-round break countdown |
| `chain:break_extended`| `session:<id>` | Admin extended pause duration |
| `wallet:updated` | `user:<userId>` | Pushes updated wallet balance |
| `deposit:updated` | `user:<userId>` | Notifies deposit approved or rejected |
| `withdrawal:updated` | `user:<userId>` | Notifies withdrawal status change |
| `user:status_changed` | `user:<userId>` | Realtime notification of account ban |
| `user:feature_settings_updated`| `user:<userId>` | Grants auto-mark or auto-bingo |
| `broadcast:new` | Broadcast all | Pushes urgent system announcement |
| `broadcast:dismiss` | Broadcast all | Dismisses system announcement |
| `support:new_message` | `user:<userId>` | Notifies player of admin reply |

### Client-to-Server WebSocket Events Catalog
| Event | Auth Required | Description |
|:---|:---|:---|
| `game:join` | Yes/Guest | Subscribes socket to `session:<sessionId>` room |
| `game:leave` | Yes | Unsubscribes socket from session room |
| `realtime:ping` | No | O(1) ultra-low-latency RTT latency probe |

---

## 7. Validation, Security & Request Pipeline

### Request Pipeline Flow
```
HTTP Request
  ├── Dynamic CORS Origin Checker (cors.config.ts)
  ├── ThrottlerGuard (Rate Limiting: Default 5000/min, Auth 200/min)
  ├── RequestLoggingInterceptor (Access & latency logging)
  ├── JwtAuthGuard / OptionalJwtAuthGuard / RolesGuard (Authentication & Authorization)
  ├── ValidationPipe (class-validator whitelist, transform, forbidNonWhitelisted)
  ├── Controller Handler & Service Execution (Database transactions & locks)
  ├── SuccessResponseInterceptor (Envelopes output in { success: true, data: ... })
  └── HttpExceptionFilter (Standardizes errors in { success: false, error: ... })
```

---

## 8. Background Schedulers & Repair Jobs

The backend includes autonomous background workers ensuring fault-tolerant operation:

1. **`AutoCallService`**: Drives the ball calling loop when `PLAYING`.
2. **`CartelaReservationExpirerService`**: Runs every 10 seconds to release cartela holds exceeding their 60-second reservation window.
3. **`RefreshTokenCleanupService`**: Runs daily to purge expired or revoked refresh tokens from PostgreSQL.
4. **`AutoReadyCountdownRepairService`**: Detects and repairs games stuck in `READY` state due to node crashes.
5. **`GameOperationRepairService`**: Recovers interrupted sessions and enforces consistency invariants.
6. **`BigGamePushReminderService`**: Schedules automated push notifications 15m and 5m before daily Big Game kickoff.
7. **`PostGameRegistrationOpenerService`**: Instantly unlocks cartela registrations for the next queued game slot when the active game finishes.
