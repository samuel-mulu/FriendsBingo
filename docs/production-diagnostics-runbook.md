# Friends Bingo — Production Diagnostics Runbook

Lightweight runbook for correlating Flutter ↔ NestJS ↔ PostgreSQL incidents.
Uses existing Docker Compose service name `api` and Nest request/claim logs.

## Prerequisites

```bash
cd /path/to/FriendsBingo
docker compose ps
```

Log rotation (after deploying compose with `logging.max-size=10m` / `max-file=5`):

```bash
docker inspect "$(docker compose ps -q api)" --format '{{json .HostConfig.LogConfig}}'
```

Applying rotation requires recreating the container (does not wipe DB volumes):

```bash
docker compose up -d --force-recreate api
```

---

## Incident: Bingo stays CHECKING

1. Get `claimAttemptId` from the player (app copy-diagnostics) or support ticket.
2. Search API logs:

```bash
docker compose logs api --since 2h 2>&1 | rg 'claimAttemptId=<UUID>'
docker compose logs api --since 2h 2>&1 | rg 'requestId=<UUID>'
```

3. Trace stages in order:
   - Flutter: `bingo.tap` / `bingo.post.start` (requestId)
   - Nest: `[bingo_claim] ... stage=received`
   - Nest: `[bingo_claim_perf] ... claimStatus=... transactionMs=...`
   - Flutter: `bingo.post.response` **or** `bingo.post.error` + `bingo.recovery.*`
   - Flutter: `bingo.state.terminal_applied` (authoritative state applied; not UI pixels)

Interpretation:

| Observation | Likely layer |
|---|---|
| No Nest `received` for requestId | Network / client never reached API |
| Nest committed VALID/INVALID, no Flutter `terminal_applied` | Client missed HTTP/socket; check recovery GET |
| Flutter `post.error` receiveTimeout + recovery VALID | Backend OK; HTTP response lost |
| Stuck CHECKING, recovery still CHECKING | Backend still processing / finalizer path |

Never treat timeout alone as INVALID.

---

## Incident: Player reports weak internet

Check Flutter export for:

- `linkQuality=weak` / banner “Connection unstable”
- `socket.disconnect` / `socket.reconnect_*`
- `bingo.post.error` with `dio=receiveTimeout` while socket still connected

Server:

```bash
docker compose logs api --since 1h 2>&1 | rg 'Socket disconnected|Socket connection'
curl -s http://127.0.0.1:4000/metrics | rg 'friends_bingo_socket_|friends_bingo_http_request_duration'
```

Distinguish:

1. Connected + weak (app RTT probe)
2. Reconnecting / offline (transport)
3. HTTP timeout with socket still up
4. Server event-loop / HTTP p99 saturation (`friends_bingo_*` process metrics)

---

## Incident: Winner window delayed

```bash
docker compose logs api --since 1h 2>&1 | rg 'winner_window\.finalization'
curl -s http://127.0.0.1:4000/metrics | rg 'friends_bingo_winner_window_'
```

Check:

- `deadlineLagMs` (finalizer started after deadline)
- `durationMs` (finalization work)
- DB/pool pressure via Postgres metrics / `friends_bingo_postgres_pool_clients`
- Final game status in logs / admin UI

Do not change winner-window duration while diagnosing.

---

## Incident: Server becomes slow

```bash
docker stats --no-stream
df -h
curl -s http://127.0.0.1:4000/metrics | rg 'friends_bingo_http_request_duration|friends_bingo_prisma_|friends_bingo_postgres_pool|nodejs_eventloop'
docker compose logs api --since 30m 2>&1 | rg 'Prisma slow query|ERROR' | tail -n 100
```

---

## Incident: Many players reconnect

```bash
docker compose logs api --since 30m 2>&1 | rg 'Socket connection|Socket disconnected'
curl -s http://127.0.0.1:4000/metrics | rg 'friends_bingo_socket_reconnects|friends_bingo_socket_room_join_failures|friends_bingo_socket_connections'
```

Look for:

- Reconnect spikes
- Room join failures
- Recovery GET / claim traffic surge
- CPU / event-loop lag

---

## Useful metrics (low cardinality)

- `friends_bingo_bingo_claims_total{status,branch}`
- `friends_bingo_bingo_claim_duration_seconds`
- `friends_bingo_bingo_claim_transaction_duration_seconds`
- `friends_bingo_winner_window_finalization_duration_seconds`
- `friends_bingo_winner_window_deadline_lag_seconds`
- `friends_bingo_socket_room_join_failures_total`
