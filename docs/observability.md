# Observability

The API now exposes Prometheus-compatible metrics at `GET /metrics`.

## Access

`/metrics` is intentionally limited to localhost and private/internal network addresses:

- `127.0.0.1`
- `::1`
- RFC1918 IPv4 ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)
- link-local/private network addresses (`169.254.0.0/16`, `fc00::/7`, `fe80::/10`)

External requests receive `403 Forbidden`.

## Quick Checks

Scrape locally:

```bash
curl -i http://127.0.0.1:3002/metrics
```

Filter a few key series:

```bash
curl -s http://127.0.0.1:3002/metrics | grep friends_bingo_http_requests_total
curl -s http://127.0.0.1:3002/metrics | grep friends_bingo_socket_connections_active
curl -s http://127.0.0.1:3002/metrics | grep friends_bingo_prisma_query_duration_seconds
curl -s http://127.0.0.1:3002/metrics | grep friends_bingo_push_batch_duration_seconds
```

Check from a pod or VM on the same private network:

```bash
curl -s http://<private-api-ip>:3002/metrics
```

## Useful Metrics

- `friends_bingo_http_requests_total`
- `friends_bingo_http_request_duration_seconds`
- `friends_bingo_http_requests_active`
- `friends_bingo_operations_current_requests_total`
- `friends_bingo_operations_current_requests_active`
- `friends_bingo_registration_state_response_size_bytes`
- `friends_bingo_socket_connections_active`
- `friends_bingo_socket_connections_by_auth`
- `friends_bingo_socket_connections_total`
- `friends_bingo_socket_disconnections_total`
- `friends_bingo_socket_reconnects_total`
- `friends_bingo_socket_rooms_active`
- `friends_bingo_socket_room_members`
- `friends_bingo_prisma_query_duration_seconds`
- `friends_bingo_postgres_pool_clients`
- `friends_bingo_push_batch_duration_seconds`
- `friends_bingo_push_deliveries_total`
- `friends_bingo_game_slots_active`
- `friends_bingo_game_sessions_active`
- `friends_bingo_process_cpu_user_seconds_total`
- `friends_bingo_process_cpu_system_seconds_total`
- `friends_bingo_process_resident_memory_bytes`
- `friends_bingo_nodejs_eventloop_lag_seconds`

## Sample Prometheus Config

```yaml
scrape_configs:
  - job_name: friends-bingo-api
    scheme: http
    metrics_path: /metrics
    scrape_interval: 15s
    static_configs:
      - targets:
          - 127.0.0.1:3002
```

Example for a private network target:

```yaml
scrape_configs:
  - job_name: friends-bingo-api-private
    metrics_path: /metrics
    scrape_interval: 15s
    static_configs:
      - targets:
          - 10.0.12.34:3002
```

## Notes

- HTTP metrics use normalized Nest/Express route templates such as `/games/operations/current` and `/games/sessions/:id/registration-state`.
- Metrics intentionally avoid `userId`, `sessionId`, `cartelaId`, and raw URL labels.
- Every HTTP response now includes `X-Request-Id`, and request/lifecycle logs include the same ID when available.
