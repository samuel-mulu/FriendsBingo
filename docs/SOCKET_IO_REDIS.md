# Friends Bingo Socket.IO Redis transport

Stage 3B changes event distribution only. PostgreSQL remains authoritative for
claims, drawing, rounds, wallets and settlements. Redis is disabled by default.
Do not enable multi-instance production until the verification gates below pass.

For the current Windows workflow without Docker Desktop, use
[isolated VPS verification over SSH](./VPS_REDIS_VERIFICATION.md). Its test-only
setup supersedes the Docker Desktop development instructions below.

## Configuration and unchanged ports

| Setting | Default / value |
| --- | --- |
| `SOCKET_IO_REDIS_ENABLED` | `false`; explicitly enable after isolated verification |
| `REDIS_URL` | Required when enabled; `redis://` or `rediss://`; private credential |
| `SOCKET_IO_REDIS_CHANNEL_PREFIX` | Required when enabled; explicit environment prefix |
| `BINGO_CLAIM_RECOVERY_ENABLED` | Keep `false`; Stage 2B rollout is separate |
| Local NestJS | Existing `PORT=3002`, HTTP and Socket.IO together |
| Docker API | Existing `PORT=4000`, `127.0.0.1:4000:4000` |
| Gateway | Existing `/realtime` namespace, `/socket.io` path |
| Redis container | Internal 6379; no production host publication |
| Windows development Redis | `127.0.0.1:16379:6379`; avoids legacy Windows 6379 |

Use `friends-bingo:local`, `friends-bingo:staging`, and
`friends-bingo:production`. All instances in one environment must use exactly the
same Redis endpoint and prefix. Different environments must have different
prefixes; Redis database numbers do not isolate Pub/Sub channels. Never mix
enabled and disabled Socket.IO adapters in a distributed pool.

`.env.redis.example` contains placeholders only. Do not copy its placeholder URL
into a running environment. Never commit the real `.env` or `.secrets/` directory.
The official adapter is pinned to 8.3.0, using the existing node-redis 6 client.

## Startup, readiness, outage and shutdown

Enabled startup connects separate named publisher/subscriber clients with a
10-second connection deadline. Nest creates the unchanged gateway and namespaces;
subscription ACKs and a private Pub/Sub round trip must pass before HTTP/Socket.IO
listening begins. Failure closes resources and exits unsuccessfully. There is no
in-memory fallback when enabled. Disabled startup follows the existing adapter.

One non-overlapping readiness probe runs every five seconds, with a two-second
deadline. Client errors, reconnects, subscription/publication rejection or a
failed probe mark realtime unavailable. `/health` returns HTTP 503 for failed
Redis readiness. Existing Engine.IO transports are closed, new handshakes are
rejected, and application broadcasts are suppressed. Transport close allows the
existing Flutter reconnect/authentication/game:join ACK flow to run again.
Ordinary HTTP endpoints and claim recovery GET remain available.

Node-redis retries connections with delays capped at two seconds. Its ready event
follows resubscription; the service also reapplies the original adapter listeners
and verifies a Pub/Sub round trip before reopening admission. Health probes do
not overlap. A stale successful probe cannot erase a concurrent failure.

Adapter 8.3 does not await publish/subscription promises. The integration catches
their rejection, marks degradation, and avoids unhandled rejection or an error
being thrown into already-committed business operations. A VALID/INVALID claim is
never changed to FAILED because event transport failed. Global user disconnect
requests fail explicitly while distributed transport is unavailable.

There is an unavoidable detection/in-flight window: a packet can reach local
clients before Redis publication fails or before subscriber failure is detected.
This does not provide atomic all-client delivery. Once degraded, broadcasting is
suppressed and clients reconnect to reconcile through authoritative HTTP state.
Redis Pub/Sub is at-most-once and does not replay missed events. Existing Flutter
reconciliation is required, including after a Redis restart.

Nest shutdown closes Socket.IO, flushes existing batches, stops the readiness
interval, and closes both Redis clients. Each client has a two-second drain
deadline, after which it is destroyed. Logs do not include Redis URLs/raw errors.

## Windows development (instructions; not executed by this change)

Install/verify Docker Desktop separately, including a usable Linux container
engine. This checkout's verification environment had no Docker executable or
installed WSL distribution. Do not use the unrelated legacy Windows Redis.

Create a private 64-character hexadecimal password once, without printing it:

```powershell
Set-Location 'D:\personal\updated friends\FriendsBingo'
New-Item -ItemType Directory -Path .secrets -Force | Out-Null
if (Test-Path -LiteralPath .secrets/redis-password) { throw 'Redis secret already exists; preserve it' }
$bingoRedisBytes = New-Object byte[] 32
$bingoRedisRng = [Security.Cryptography.RandomNumberGenerator]::Create()
$bingoRedisRng.GetBytes($bingoRedisBytes)
$bingoRedisRng.Dispose()
$bingoRedisPassword = -join ($bingoRedisBytes | ForEach-Object { $_.ToString('x2') })
[IO.File]::WriteAllText((Join-Path (Get-Location) '.secrets/redis-password'), $bingoRedisPassword)
docker compose -p bingo-redis-local -f docker-compose.redis-dev.yml up -d --wait
```

This standalone Compose file starts Redis only; it does not load the API `.env`
or start/change PostgreSQL. Redis requires the secret, uses an internal network,
has a health check and restart policy, and disables RDB/AOF persistence. The
supported official image is pinned to `redis:8.4.6-alpine`; runtime/container
compatibility still requires verification on the actual Docker engine.

For the intended development process, use process-scoped settings (no `.env`
change required). Do this only when you are ready to restart your own development
process; never start a replacement while the existing port-3002 process runs.

```powershell
$bingoRedisPassword = [IO.File]::ReadAllText((Join-Path (Get-Location) '.secrets/redis-password')).Trim()
$env:SOCKET_IO_REDIS_ENABLED = 'true'
$env:REDIS_URL = "redis://:$bingoRedisPassword@127.0.0.1:16379/0"
$env:SOCKET_IO_REDIS_CHANNEL_PREFIX = 'friends-bingo:local'
$env:BINGO_CLAIM_RECOVERY_ENABLED = 'false'
npm run start:dev
```

Leave the existing local `PORT=3002` unchanged. Flutter URLs, transports and event
names need no changes. Closing this shell discards these process overrides.

## Isolated tests and outstanding gates

Default regression commands do not load a real Redis/database URL:

```powershell
node node_modules/jest/bin/jest.js --runInBand --no-cache --silent
node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit --incremental false
npm run build
```

`socket-io-redis.service.spec.ts` covers dependency failures with deterministic
clients and the real official adapter. `redis-io.adapter.spec.ts` uses real Nest
gateways, Socket.IO clients and ephemeral loopback ports for disabled operation,
authentication, game:join ACK, existing event payloads and single delivery. Its
startup blackhole test uses actual node-redis clients without a Redis server.

The opt-in two-instance suite requires BOTH `BINGO_REDIS_TEST_URL` and
`BINGO_FENCING_TEST_DATABASE_URL`. It refuses endpoints other than
`127.0.0.1:16379` and `127.0.0.1:65439/stage2a_claim_fencing`. Supply only dedicated
test infrastructure. It never falls back to DATABASE_URL, DIRECT_URL or `.env`.
PostgreSQL authentication fixtures use connection-local temporary tables; the
suite tests transport rather than real claim validation or settlement. Each run
has unique channels/client names. Connection-loss tests kill only this run's
Redis clients. Both backend ports are allocated with port 0; 3002 is untouched.

```powershell
# Set these privately to the isolated services, not the development/remote DB.
$env:BINGO_REDIS_TEST_URL = "redis://:$bingoRedisPassword@127.0.0.1:16379/0"
# BINGO_FENCING_TEST_DATABASE_URL must point to the dedicated local test database.
node node_modules/jest/bin/jest.js --runInBand --no-cache --silent src/realtime/redis-io.adapter.spec.ts
```

Before release, additionally run real PostgreSQL fencing/recovery regressions and
the full Stage 3 Flutter/backend staging scenarios: actual five-category claims,
expired windows, simultaneous players, pause restoration, Chain round boundaries,
Big Game intermediate/final handoff, presentation and wallet/settlement consistency.
Transport fixtures alone do not prove those flows.

On dedicated staging, verify Redis process stop/start (not only CLIENT KILL),
publisher failure, subscriber resubscription, readiness 503->200, Flutter rejoin
and GET recovery, no duplicate delivery, and shutdown with pending commands.
Do not stop shared Redis or the user's existing development API. Measure claim
p50/p95, broadcast latency and restart-to-readiness from actual runs. No real Redis
outage/restart or cross-instance performance result is claimed by mock tests.

## Per-process scheduler audit and production restriction

| Component | Existing protection | Remaining distributed concern |
| --- | --- | --- |
| Auto-call (`auto-call.service.ts`, `called-numbers.service.ts`) | Conditional due-schedule update inside draw transaction; losing workers skip | Timing/start restoration and stale concurrent scans need real two-process PostgreSQL tests |
| Winner windows (`winner-window-finalizer.service.ts`, `bingo-claims.service.ts`) | Conditional `prizeFinalizedAt` claim in finalization transaction | Prove payout and post-commit round/event side effects under competing processes |
| Chain resume (`chain-round-resume.service.ts`) | Conditional pause-clear selects one winner | Pause clear, round event and startAutoCall are separate operations; crash gap and newer-round race remain unproven |
| Auto-start / Big Game (`game-auto-start-scheduler.service.ts`, `game-engine.service.ts`, `big-game-round.service.ts`) | Session lock plus conditional READY transition | Slot/session lock ordering, scheduler scans and registration opening need distributed verification |
| Orphan scan (`bingo-claim-recovery.service.ts`, `bingo-claims.service.ts`) | Stage 2A session->claim fences; Stage 2B SKIP LOCKED and conditional terminal update | Disabled; all backend versions must have compatible fencing before any separate enablement |
| Operations cache (`operations-cache.service.ts`) | Local generation and 1-second TTL | Invalidations are process-local; another instance can serve a stale snapshot until TTL |
| Cartela event batches (`realtime.service.ts`) | Existing per-process timers | Multiple instances may emit separate batches; consumer ordering/convergence needs staging tests |

Redis does not elect a scheduler owner, share cache invalidation or make these
jobs exactly once. Production multi-instance is NO-GO until a separate focused
coordination/verification phase resolves these concerns. No scheduler, wallet,
claim, recovery-worker, game-rule or schema change is part of Stage 3B.

## Future VPS Docker rollout (not an assertion about the current VPS)

First establish whether the actual VPS uses Compose, PM2 or direct Node. The
existing Docker files do not prove the live deployment method. For Compose:

1. Review/test the image and Compose rendering on isolated infrastructure. Prepare
   a private `.secrets/redis-password` file with restrictive host permissions;
   never put it in Git. Use the same hex-password convention as Windows.
2. Start Redis first: `docker compose --profile socket-redis up -d --wait redis`.
   The main Compose Redis service has no published host ports, an internal network
   and health check. Existing PostgreSQL settings/data and API 4000 mapping stay
   unchanged. No migration is required by Redis transport.
3. Configure the private API environment with the Redis container URL
   `redis://:<private-password>@redis:6379/0` and environment-specific prefix.
   Keep both feature flags false while deploying/reviewing the integration.
4. After isolated tests pass, enable Socket.IO Redis on the single approved
   instance and check readiness, reconnect and HTTP recovery. Do not enable the
   claim orphan worker as part of this rollout.
5. Add further instances only after the scheduler coordination gate passes.
   Every instance must use the same adapter/configuration. A reverse proxy/load
   balancer must use sticky sessions for polling clients; Redis does not remove
   that requirement. Keep the public Flutter URLs and default transports.

Production Redis must stay on the private container network, authenticated and
firewalled. For direct Node/PM2 deployment, design private reachability after
verifying the actual topology; do not publish Redis on 0.0.0.0 or add a permanent
5001 API. Channel prefixes alone are not authorization between untrusted apps.

## Monitoring and rollback

Monitor `/health` readiness, sanitized Redis transition logs, Redis connected
clients/subscriptions, reconnection rates, recovery GET errors/attempt counts,
claim CHECKING age, auto-call schedule gaps, database lock waits and settlements.
Health 503 should remove an enabled instance from realtime traffic; HTTP recovery
remains operational directly. Missed notifications must be reconciled, not
replayed as new claims.

Rollback must first drain/remove all additional instances. Then set
`SOCKET_IO_REDIS_ENABLED=false` on the remaining single instance and restart it
using the existing deployment method. Keep recovery false, schema/data and prior
stages intact. Stop only the dedicated Redis service if desired. Never disable
Redis on just one member of a live distributed pool. Code rollback should remove
only the Stage 3B transport/config/dependency additions, preserving the already
dirty Stage 1/2A/2B/3A and unrelated migration edits. Do not use a broad git reset.

References: [official Socket.IO Redis adapter](https://socket.io/docs/v4/redis-adapter/),
[multi-node/sticky-session requirements](https://socket.io/docs/v4/using-multiple-nodes/),
[Redis Pub/Sub delivery](https://redis.io/docs/latest/develop/pubsub/),
[Redis supported versions](https://github.com/redis/redis/security/policy).
