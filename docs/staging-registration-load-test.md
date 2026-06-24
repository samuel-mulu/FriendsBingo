# Staging Registration Load Test

This script exercises the real registration endpoints against staging so we can
measure burst behavior before a larger launch push.

## Safety

- The script refuses non-staging targets unless
  `LOAD_TEST_ALLOW_NON_STAGING=true` is set deliberately.
- Use dedicated staging player accounts and a prepared slot/session.
- Do not point this at production.

## Supported Scenarios

- `bulk`
  - Calls `POST /games/slots/:slotId/register-cartelas-bulk`
  - Best for the current high-volume registration path
- `reserve-confirm`
  - Calls reserve plus confirm endpoints for each cartela
  - Useful if we want to compare reservation churn against the bulk path

## Required Inputs

- `LOAD_TEST_BASE_URL`
- `LOAD_TEST_PLAN_FILE`
- `LOAD_TEST_SLOT_ID` for `bulk`
- `LOAD_TEST_SESSION_ID` or `LOAD_TEST_SLOT_ID` for `reserve-confirm`

Use the example plan at
`scripts/examples/staging-registration-load-plan.example.json` as the template.

Each player entry needs:

- a real staging JWT
- one or more cartelas
- `cartelaNumber` for `bulk`

## Example Runs

100 users across a 3-minute registration window:

```powershell
$env:LOAD_TEST_BASE_URL="https://staging-api.example.com"
$env:LOAD_TEST_PLAN_FILE=".\scripts\examples\staging-registration-load-plan.example.json"
$env:LOAD_TEST_SLOT_ID="replace-with-slot-uuid"
$env:LOAD_TEST_SCENARIO="bulk"
$env:LOAD_TEST_DURATION_MS="180000"
$env:LOAD_TEST_MAX_PARALLEL="100"
npm run test:load:registration:staging
```

Reserve/confirm comparison run:

```powershell
$env:LOAD_TEST_BASE_URL="https://staging-api.example.com"
$env:LOAD_TEST_PLAN_FILE=".\scripts\examples\staging-registration-load-plan.example.json"
$env:LOAD_TEST_SESSION_ID="replace-with-session-uuid"
$env:LOAD_TEST_SCENARIO="reserve-confirm"
$env:LOAD_TEST_DURATION_MS="180000"
$env:LOAD_TEST_MAX_PARALLEL="50"
npm run test:load:registration:staging
```

## Output

The script prints:

- player count
- attempted cartelas
- successful, conflict, and failed request counts
- succeeded and failed cartela totals
- latency `min`, `p50`, `p95`, and `max`
- up to 20 sample errors for debugging

## What To Watch

- unexpected `500` or timeout spikes
- high conflict rates when the test plan should be non-overlapping
- p95 latency growth as concurrency rises
- error bodies that suggest wallet, reservation, or duplicate-write issues
