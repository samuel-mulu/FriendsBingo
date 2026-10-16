# Lightweight load-test harness (staging / local only)

**Do not run against production.**

## Goals

Exercise Socket.IO + claim + reconnect paths at:

- 100 / 500 / 1,000 concurrent clients
- 5,000 only if staging capacity permits

## What to reuse

- Existing Socket.IO `/realtime` namespace
- Existing `realtime:ping` ACK (15s client interval; do not increase)
- Existing HTTP bingo claim + recovery GET
- Prometheus `/metrics`

## Suggested client behavior (script outline)

Per virtual player:

1. Authenticate (staging test tokens) or guest connect where allowed
2. Connect Socket.IO once (no second connection)
3. `game:join` with ACK
4. Idle with Engine.IO keepalive; optional app ping every 15s if testing banner path
5. Occasional claim POST with unique `claimAttemptId` + unique `X-Request-Id`
6. Random disconnect/reconnect bursts
7. Recovery GET for ambiguous claims

Prefer `k6`, `artillery`, or a small Node `socket.io-client` script already used in `scripts/`.

## Metrics to capture

- HTTP p50/p95/p99 (`friends_bingo_http_request_duration_seconds`)
- Claim p50/p95/p99 (`friends_bingo_bingo_claim_duration_seconds`)
- Socket reconnect success / room join failures
- Event-loop lag / CPU / memory (`docker stats`, default Node metrics)
- Postgres pool gauges
- Winner-window finalization lag
- Log volume / disk (`df -h`, container log sizes)

## Safety

- Cap concurrency
- Stop on error-rate thresholds
- Never invent capacity numbers — only report measured runs
