# Bad-network reliability coverage matrix

| # | Scenario | Automated coverage | Manual / staging |
|---|---|---|---|
| 1 | Stable Wi-Fi | Link-quality healthy path unit tests | Smoke on staging |
| 2 | High RTT | `socket_link_quality_test` high rolling RTT | Device with network conditioner |
| 3 | Packet loss | Missed ACK / consecutive miss → weak | Staging packet-loss profile |
| 4 | Wi-Fi ↔ mobile switch | Socket disconnect/reconnect diagnostics | Manual device switch |
| 5 | Socket disconnect during claim POST | Existing claim recovery lifecycle + diagnostics `post.error` | Staging |
| 6 | HTTP timeout after backend commit | Recovery GET + same UUID retry tests | Staging |
| 7 | Missed terminal socket event | Recovery path + `bingo.socket.terminal_received` vs `terminal_applied` | Staging |
| 8 | Reconnect during winner window | Resume sync gate + membership tests | Staging |
| 9 | Reconnect after FINISHED | Existing terminal resume gates | Staging |
| 10 | Simultaneous multi-cartela claims | Nest fencing / concurrency postgres specs | Staging |
| 11 | Auto Bingo poor connectivity | Quiet auto failure + recovery paths | Staging |
| 12 | App background/resume | Link-quality background clear + membership foreground | Device |
| 13 | Late HTTP after recovery | Claim callback identity / historical resolve | Covered in lifecycle tests |
| 14 | Duplicate socket terminal | `processedResolvedClaimIds` dedupe | Covered in orchestration |
| 15 | Duplicate HTTP same claimAttemptId | Nest idempotency specs | Covered |
| 16 | Authoritative INVALID/FAILED | Claim status mapping + recovery apply | Covered |

**Invariant:** timeout / ambiguous network never becomes INVALID without authoritative backend status.
