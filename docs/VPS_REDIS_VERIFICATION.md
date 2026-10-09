# Isolated VPS verification from Windows

Status: prepared locally; not executed on a VPS. No VPS login was supplied and
the current VPS services, resources, Docker version and deployment method are
unknown. Obtain approval after reviewing the read-only preflight below, before
creating directories, uploading files, pulling images or starting containers.

Windows continues to use `npm run start` and the existing `PORT=3002`.
Do not install Docker Desktop, use the legacy Windows Redis on 6379, change
Flutter URLs, deploy the application or enable production feature flags.

## 1. Read-only VPS preflight

Replace `SSH_USER@VPS_HOST` with the real SSH login, or use your existing SSH
alias. Run this login from Windows, then run the Linux commands on the VPS:

```powershell
ssh SSH_USER@VPS_HOST
```

```bash
docker version
docker compose version
docker context show
docker context inspect --format '{{.Endpoints.docker.Host}}'
docker info --format 'Root={{.DockerRootDir}} CPUs={{.NCPU}} Memory={{.MemTotal}}'
docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
docker compose ls --all
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}'
docker network ls
docker network inspect --format '{{.Name}} {{.Driver}} {{range .IPAM.Config}}{{.Subnet}} {{end}}' $(docker network ls -q)
docker volume ls
docker system df
systemctl list-units --type=service --state=running --no-pager
ss -lnt
ss -lnt '( sport = :16379 or sport = :65439 )'
free -h
df -h /
df -h "$(docker info --format '{{.DockerRootDir}}')"
uptime
getconf _NPROCESSORS_ONLN
command -v openssl
test ! -e "$HOME/bingo-verify" && echo 'Test directory available'
docker ps -a --filter label=com.docker.compose.project=bingo-verify --format '{{.Names}}'
```

Do not share `.env`, container environment dumps, credentials or private keys.
Confirm the Docker endpoint is the intended local VPS daemon, both test ports
are unused, and no existing project/directory named `bingo-verify` exists.
Stop if any check fails. Do not stop production services, change firewall rules,
prune Docker resources, upgrade Docker or change network configuration here.

Require Docker Engine 28 or newer: earlier engines have a documented localhost
published-port exposure issue for hosts on the same L2 network. If an older
engine is installed, report it as a blocker rather than changing the VPS.
Require Compose support for `up --wait` and the resource limits used here.

The configured container memory limits total 640 MiB, with CPU ceilings of
0.25 for Redis and 0.5 for PostgreSQL. These are ceilings, not reservations or
proof of available capacity. As a conservative starting gate, require at least
1 GiB available memory, 2 GiB free Docker-storage disk space and CPU headroom
after inspecting production usage. Do not start tests on a constrained VPS.
Resource caps, image pulls and test writes can still affect shared disk/CPU.

**STOP: review this output and obtain approval before all remaining VPS steps.**

## 2. Approved test infrastructure only

The standalone `docker-compose.verification.yml` contains no API service,
production environment file or external/shared volume/network. Always use the
explicit project `bingo-verify`; never combine it with `docker-compose.yml`.
The only database bindings are VPS loopback 16379 and 65439. Redis disables
RDB/AOF. PostgreSQL uses one new project-scoped test volume, deleted at cleanup.
Neither container automatically starts again after a VPS reboot.

After approval, on the VPS:

```bash
set -eu
umask 077
test ! -e "$HOME/bingo-verify"
mkdir -m 700 "$HOME/bingo-verify"
mkdir -m 700 "$HOME/bingo-verify/.secrets"
openssl rand -hex 32 > "$HOME/bingo-verify/.secrets/verification-redis-password"
openssl rand -hex 32 > "$HOME/bingo-verify/.secrets/verification-postgres-password"
chmod 600 "$HOME/bingo-verify/.secrets/verification-redis-password" "$HOME/bingo-verify/.secrets/verification-postgres-password"
```

Upload only the test Compose file from Windows, not the app or its `.env`:

```powershell
Set-Location 'D:\personal\updated friends\FriendsBingo'
scp .\docker-compose.verification.yml SSH_USER@VPS_HOST:bingo-verify/docker-compose.verification.yml
```

On the VPS:

```bash
cd "$HOME/bingo-verify"
docker compose --env-file /dev/null -p bingo-verify -f docker-compose.verification.yml config --quiet
docker compose --env-file /dev/null -p bingo-verify -f docker-compose.verification.yml up -d --wait --wait-timeout 120
docker compose --env-file /dev/null -p bingo-verify -f docker-compose.verification.yml ps
docker compose --env-file /dev/null -p bingo-verify -f docker-compose.verification.yml exec -T redis sh -ec 'REDISCLI_AUTH="$(cat /run/secrets/verification_redis_password)" redis-cli ping'
docker compose --env-file /dev/null -p bingo-verify -f docker-compose.verification.yml exec -T postgres sh -ec 'PGPASSWORD="$(cat /run/secrets/verification_postgres_password)" psql -h 127.0.0.1 -U bingo_verify -d stage2a_claim_fencing -Atqc "SELECT current_database(), current_user"'
```

Expected: both services healthy, authenticated `PONG`, and
`stage2a_claim_fencing|bingo_verify`. These are expected values, not measured
results. Do not print passwords or connection URLs. A failed health check is a
blocker; do not work around it with production databases or weaker auth.

## 3. Windows SSH tunnel and private test credentials

First confirm Windows loopback ports 16379 and 65439 are free. In a dedicated
PowerShell window, keep this command running throughout verification:

```powershell
ssh -N -T -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L 127.0.0.1:16379:127.0.0.1:16379 -L 127.0.0.1:65439:127.0.0.1:65439 SSH_USER@VPS_HOST
```

Do not forward port 3002 or 6379. Do not publish database ports publicly.
Use the normal SSH host-key verification; never disable it. Adjust SSH login
and SSH port only to the actual server configuration.

In a separate, fresh PowerShell test window (not the window running your API):

```powershell
Set-Location 'D:\personal\updated friends\FriendsBingo'
New-Item -ItemType Directory -Path .secrets -Force | Out-Null
if ((Test-Path .secrets/verification-redis-password) -or (Test-Path .secrets/verification-postgres-password)) { throw 'Preserve existing test secrets; review before replacing' }
scp SSH_USER@VPS_HOST:bingo-verify/.secrets/verification-redis-password .secrets/verification-redis-password
if ($LASTEXITCODE -ne 0) { throw 'Redis secret transfer failed' }
scp SSH_USER@VPS_HOST:bingo-verify/.secrets/verification-postgres-password .secrets/verification-postgres-password
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL secret transfer failed' }

$bingoVerifyRedisPassword = [IO.File]::ReadAllText((Join-Path (Get-Location) '.secrets/verification-redis-password')).Trim()
$bingoVerifyPgPassword = [IO.File]::ReadAllText((Join-Path (Get-Location) '.secrets/verification-postgres-password')).Trim()
if ($bingoVerifyRedisPassword -cnotmatch '^[a-f0-9]{64}$' -or $bingoVerifyPgPassword -cnotmatch '^[a-f0-9]{64}$') { throw 'Unexpected test secret format' }
$env:BINGO_REDIS_TEST_URL = "redis://:$bingoVerifyRedisPassword@127.0.0.1:16379/0"
$env:BINGO_FENCING_TEST_DATABASE_URL = "postgresql://bingo_verify:$bingoVerifyPgPassword@127.0.0.1:65439/stage2a_claim_fencing"
$env:BINGO_CLAIM_RECOVERY_ENABLED = 'false'
```

These are process-scoped, test-only variables. `.secrets/` is already ignored by
Git. Keep the directory private to your Windows account. Do not echo variables,
transcribe the test shell, paste URLs into logs or copy production credentials.
No change to `.env`, `DATABASE_URL`, `DIRECT_URL`, `REDIS_URL`, `PORT` or production
feature flags is required. The opt-in Socket.IO test fixtures enable Redis only
inside their own isolated Nest test modules. They do not start the full AppModule
or production schedulers. Do not use `npm run start` to create a second test API
against your normal remote `.env` database.

## 4. Schema provisioning and existing suites

Provision only the newly created empty test database through the tunnel:

```powershell
node node_modules/prisma/build/index.js db push --config prisma.verification.config.ts
if ($LASTEXITCODE -ne 0) { throw 'Isolated schema provisioning failed' }
```

The separate Prisma config does not load `.env` and rejects any endpoint except
`postgresql://...@127.0.0.1:65439/stage2a_claim_fencing`. No migrations are run,
and the schema file is unchanged. Do not use the normal Prisma config, reset,
`--force-reset` or `--accept-data-loss`. If the database is not empty, stop and
review its identity before any schema operation.

Run the existing suites, recording actual summaries and durations:

```powershell
node node_modules/jest/bin/jest.js --runInBand --no-cache src/realtime/redis-io.adapter.spec.ts
if ($LASTEXITCODE -ne 0) { throw 'Socket.IO Redis tests failed' }
node node_modules/jest/bin/jest.js --runInBand --no-cache src/bingo-claims/bingo-claims-fencing.postgres.spec.ts
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL fencing/recovery tests failed' }
node node_modules/jest/bin/jest.js --runInBand --no-cache src/games/chain-round-resume.service.spec.ts src/games/chain-round.util.spec.ts src/games/chain-game-rounds.spec.ts
if ($LASTEXITCODE -ne 0) { throw 'Chain regressions failed' }
node node_modules/jest/bin/jest.js --runInBand --no-cache --silent
if ($LASTEXITCODE -ne 0) { throw 'Full backend suite failed' }
node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit --incremental false
if ($LASTEXITCODE -ne 0) { throw 'Production TypeScript check failed' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
git diff --check
```

With both test URLs present, the adapter suite should include its eight opt-in
Redis tests in addition to nine default tests. The PostgreSQL suite currently
contains 77 opt-in tests. Missing variables cause skips, which must be reported
as skips, not passes. No real infrastructure pass is claimed by this runbook.

The PostgreSQL suite writes/deletes only its fixtures in the dedicated database;
some tests intentionally roll back/terminate their own test connections. Keep
these URLs confined to the fresh test shell. Orphan recovery remains disabled on
the normal application; recovery tests instantiate isolated service fixtures.

## 5. Restart and remaining verification gates

After the suites finish, restart only the dedicated Redis container on the VPS:

```bash
cd "$HOME/bingo-verify"
docker compose --env-file /dev/null -p bingo-verify -f docker-compose.verification.yml restart redis
docker compose --env-file /dev/null -p bingo-verify -f docker-compose.verification.yml up -d --wait --wait-timeout 120 redis
docker compose --env-file /dev/null -p bingo-verify -f docker-compose.verification.yml exec -T redis sh -ec 'REDISCLI_AUTH="$(cat /run/secrets/verification_redis_password)" redis-cli ping'
```

Rerun the adapter suite after restart. This proves restart/startup connectivity
only; it does not prove recovery of a continuously running backend. Its existing
connection-loss tests exercise subscriber/publisher reconnection with CLIENT
KILL, not a Redis process outage. The two Nest apps in that suite run in the
same Node process with ephemeral ports; they are not two separate OS processes.

Before production approval, additional isolated verification must cover:

- Two separate test Node processes sharing one Redis/prefix and dedicated PG,
  each binding a free loopback port; do not launch the normal AppModule/.env.
  Verify session/user/admin delivery, disconnectUser, auth/join ACK, reconnect,
  polling and WebSocket. No permanent port-5001 instance is needed.
- Redis stop/start while those test processes remain running: readiness
  degradation, resubscription, rejoin, HTTP canonical reconciliation, delivery
  counts and graceful shutdown. Missed Pub/Sub packets are not replayed.
- Stage 3B.2 Chain ownership with real PostgreSQL competing connections: exact
  round/pause match, stale round/deadline, duplicate and concurrent callbacks,
  commit/rollback and no stale event/automatic-call start. The existing 18-test
  Chain resume suite uses deterministic in-memory ownership fixtures; passing
  the 77 claim tests does not prove this separate fix.
- Exactly-once real wallet/settlement and round handoff under concurrent
  finalizers; claim fencing tests alone do not establish settlement safety.
- Measured event delivery latency (samples/p50/p95), restart-to-ready duration
  and database lock waits, separately identifying SSH/network overhead.

Those additional harnesses/scenarios are pending; no completed separate-process,
real Chain concurrency, live-outage, latency or settlement result is implied.
Do not change scheduler ownership in this phase. Multi-instance production
remains NO-GO until these gates and the process-local scheduler/cache audit are
resolved. Single-instance Redis production remains unapproved pending real
infrastructure and outage verification. Keep orphan recovery disabled; never
enable it while older unfenced backend instances exist.

## 6. Cleanup (test resources only)

After tests and approval to discard their data, on the VPS:

```bash
cd "$HOME/bingo-verify"
docker compose --env-file /dev/null -p bingo-verify -f docker-compose.verification.yml ps
docker compose --env-file /dev/null -p bingo-verify -f docker-compose.verification.yml down --volumes
```

This targets only the `bingo-verify` services, its network and its new test PG
volume. Do not use a global stop/prune or the production Compose file. Images
and the private test directory/secret files remain; do not delete any production
volume or secrets. Close the SSH tunnel with Ctrl+C and close the fresh test
PowerShell window to discard its environment. For reuse, review the existing
directory/secrets instead of rerunning the first-time creation commands.

References: [Docker Compose service options](https://docs.docker.com/reference/compose-file/services/),
[localhost publishing and older-engine warning](https://docs.docker.com/engine/network/port-publishing/),
[PostgreSQL image password files](https://hub.docker.com/_/postgres),
[OpenSSH local forwarding](https://man.openbsd.org/ssh.1),
[Prisma explicit configuration](https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference).
