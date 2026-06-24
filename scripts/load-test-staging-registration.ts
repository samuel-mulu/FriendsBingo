/**
 * Staging-only registration burst load test.
 *
 * This script exercises the real HTTP registration paths against a prepared
 * staging environment. It intentionally refuses non-staging targets unless the
 * caller opts in explicitly.
 *
 * Run with:
 *   npm run test:load:registration:staging
 *
 * Required env:
 *   LOAD_TEST_BASE_URL=https://staging-api.example.com
 *   LOAD_TEST_PLAN_FILE=./scripts/examples/staging-registration-load-plan.example.json
 *
 * One of:
 *   LOAD_TEST_SLOT_ID=<slot uuid>
 *   LOAD_TEST_SESSION_ID=<session uuid>
 *
 * Optional env:
 *   LOAD_TEST_SCENARIO=bulk | reserve-confirm   (default: bulk)
 *   LOAD_TEST_DURATION_MS=180000                (default: 180000)
 *   LOAD_TEST_MAX_PARALLEL=100                  (default: 100)
 *   LOAD_TEST_WARM_REGISTRATION_STATE=true      (default: false)
 *   LOAD_TEST_ALLOW_NON_STAGING=true            (default: false)
 *
 * Plan file format:
 * {
 *   "players": [
 *     {
 *       "label": "player-001",
 *       "token": "<jwt>",
 *       "cartelas": [
 *         { "cartelaId": "<uuid>", "cartelaNumber": 12 },
 *         { "cartelaId": "<uuid>", "cartelaNumber": 44 }
 *       ]
 *     }
 *   ]
 * }
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type Scenario = 'bulk' | 'reserve-confirm';

type CartelaPlan = {
  cartelaId: string;
  cartelaNumber?: number;
};

type PlayerPlan = {
  label: string;
  token: string;
  cartelas: CartelaPlan[];
};

type LoadTestPlanFile =
  | {
      players: PlayerPlan[];
    }
  | PlayerPlan[];

type RequestMetric = {
  label: string;
  endpoint: string;
  startedAt: string;
  durationMs: number;
  ok: boolean;
  statusCode: number;
  attemptedCartelas: number;
  succeededCartelas: number;
  failedCartelas: number;
  responseKind: 'success' | 'conflict' | 'failure';
  errorMessage?: string;
};

const baseUrl = requireEnv('LOAD_TEST_BASE_URL');
const planFile = requireEnv('LOAD_TEST_PLAN_FILE');
const slotId = process.env.LOAD_TEST_SLOT_ID?.trim() || null;
const sessionId = process.env.LOAD_TEST_SESSION_ID?.trim() || null;
const scenario = parseScenario(process.env.LOAD_TEST_SCENARIO);
const durationMs = parsePositiveInt(
  process.env.LOAD_TEST_DURATION_MS,
  180_000,
);
const maxParallel = parsePositiveInt(process.env.LOAD_TEST_MAX_PARALLEL, 100);
const warmRegistrationState =
  process.env.LOAD_TEST_WARM_REGISTRATION_STATE === 'true';
const allowNonStaging = process.env.LOAD_TEST_ALLOW_NON_STAGING === 'true';

async function main() {
  ensureSafeTarget(baseUrl, allowNonStaging);

  if (!slotId && !sessionId) {
    throw new Error(
      'Set LOAD_TEST_SLOT_ID or LOAD_TEST_SESSION_ID for the staging scenario.',
    );
  }

  if (scenario === 'bulk' && !slotId) {
    throw new Error('LOAD_TEST_SLOT_ID is required for bulk registration.');
  }

  const players = await loadPlan(planFile);
  if (players.length === 0) {
    throw new Error('Plan file has no players.');
  }

  console.log(
    JSON.stringify(
      {
        message: 'Starting staging registration load test',
        baseUrl,
        slotId,
        sessionId,
        scenario,
        durationMs,
        maxParallel,
        playerCount: players.length,
        attemptedCartelas: players.reduce(
          (sum, player) => sum + player.cartelas.length,
          0,
        ),
      },
      null,
      2,
    ),
  );

  if (warmRegistrationState) {
    await warmReadEndpoints(players);
  }

  const startedAt = Date.now();
  const metrics = await runScheduledBurst(players, startedAt);
  const summary = summarizeMetrics(metrics, startedAt);

  console.log(JSON.stringify(summary, null, 2));

  if (summary.failedRequests > 0) {
    process.exitCode = 1;
  }
}

async function loadPlan(filePath: string): Promise<PlayerPlan[]> {
  const raw = await readFile(resolve(filePath), 'utf8');
  const parsed = JSON.parse(raw) as LoadTestPlanFile;
  const players = Array.isArray(parsed) ? parsed : parsed.players;

  if (!Array.isArray(players)) {
    throw new Error('Plan file must be an array or { players: [...] }.');
  }

  return players.map((player, index) => {
    const label = player.label?.trim() || `player-${index + 1}`;
    const token = player.token?.trim();
    const cartelas = Array.isArray(player.cartelas) ? player.cartelas : [];

    if (!token) {
      throw new Error(`Plan entry ${label} is missing token.`);
    }

    if (cartelas.length === 0) {
      throw new Error(`Plan entry ${label} has no cartelas.`);
    }

    return {
      label,
      token,
      cartelas: cartelas.map((cartela, cartelaIndex) => {
        const cartelaId = cartela.cartelaId?.trim();
        if (!cartelaId) {
          throw new Error(
            `Plan entry ${label} cartela #${cartelaIndex + 1} is missing cartelaId.`,
          );
        }

        const cartelaNumber = cartela.cartelaNumber;
        if (
          scenario === 'bulk' &&
          (!Number.isInteger(cartelaNumber) || (cartelaNumber as number) <= 0)
        ) {
          throw new Error(
            `Plan entry ${label} cartela #${cartelaIndex + 1} must include a positive integer cartelaNumber for bulk registration.`,
          );
        }

        return {
          cartelaId,
          cartelaNumber,
        };
      }),
    };
  });
}

async function warmReadEndpoints(players: PlayerPlan[]) {
  const warmers = players.slice(0, Math.min(players.length, 10)).map((player) =>
    hitRegistrationState(player.token).catch((error: unknown) => {
      console.warn(
        `[load-test] warm registration-state failed for ${player.label}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }),
  );

  await Promise.all(warmers);
}

async function runScheduledBurst(
  players: PlayerPlan[],
  startedAt: number,
): Promise<RequestMetric[]> {
  const metrics: RequestMetric[] = [];
  let nextIndex = 0;
  let active = 0;

  return new Promise((resolvePromise) => {
    const maybeLaunch = () => {
      while (active < maxParallel && nextIndex < players.length) {
        const playerIndex = nextIndex++;
        const player = players[playerIndex];
        const scheduledOffsetMs = Math.floor(
          (durationMs * playerIndex) / Math.max(players.length, 1),
        );

        active += 1;
        void runPlayerAtOffset(player, startedAt, scheduledOffsetMs)
          .then((metric) => {
            metrics.push(metric);
          })
          .catch((error: unknown) => {
            metrics.push({
              label: player.label,
              endpoint: scenario === 'bulk' ? bulkEndpoint() : reserveEndpoint(),
              startedAt: new Date().toISOString(),
              durationMs: 0,
              ok: false,
              statusCode: 0,
              attemptedCartelas: player.cartelas.length,
              succeededCartelas: 0,
              failedCartelas: player.cartelas.length,
              responseKind: 'failure',
              errorMessage:
                error instanceof Error ? error.message : String(error),
            });
          })
          .finally(() => {
            active -= 1;
            if (nextIndex >= players.length && active === 0) {
              resolvePromise(metrics);
              return;
            }

            maybeLaunch();
          });
      }
    };

    maybeLaunch();
  });
}

async function runPlayerAtOffset(
  player: PlayerPlan,
  startedAt: number,
  scheduledOffsetMs: number,
): Promise<RequestMetric> {
  const dueAt = startedAt + scheduledOffsetMs;
  const sleepMs = dueAt - Date.now();
  if (sleepMs > 0) {
    await delay(sleepMs);
  }

  if (scenario === 'bulk') {
    return runBulkRegistration(player);
  }

  return runReserveConfirmRegistration(player);
}

async function runBulkRegistration(player: PlayerPlan): Promise<RequestMetric> {
  const endpoint = bulkEndpoint();
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const response = await fetchJson(endpoint, {
    method: 'POST',
    headers: authHeaders(player.token),
    body: JSON.stringify({
      cartelas: player.cartelas.map((cartela) => ({
        cartelaId: cartela.cartelaId,
        cartelaNumber: cartela.cartelaNumber ?? 0,
      })),
    }),
  });

  const durationMs = Date.now() - start;
  const body = response.body as
    | {
        successes?: unknown[];
        failures?: unknown[];
      }
    | undefined;
  const succeededCartelas = body?.successes?.length ?? 0;
  const failedCartelas = body?.failures?.length ?? 0;
  const ok = response.ok && failedCartelas === 0;

  return {
    label: player.label,
    endpoint,
    startedAt,
    durationMs,
    ok,
    statusCode: response.statusCode,
    attemptedCartelas: player.cartelas.length,
    succeededCartelas,
    failedCartelas,
    responseKind: classifyResponseKind(response.statusCode, ok),
    errorMessage:
      !ok && response.body != null ? JSON.stringify(response.body) : undefined,
  };
}

async function runReserveConfirmRegistration(
  player: PlayerPlan,
): Promise<RequestMetric> {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  let succeededCartelas = 0;
  let failedCartelas = 0;
  let lastStatusCode = 200;
  let lastErrorMessage: string | undefined;

  for (const cartela of player.cartelas) {
    const reserveResponse = await fetchJson(reserveEndpoint(cartela.cartelaId), {
      method: 'POST',
      headers: authHeaders(player.token),
    });

    lastStatusCode = reserveResponse.statusCode;

    if (!reserveResponse.ok) {
      failedCartelas += 1;
      lastErrorMessage = JSON.stringify(reserveResponse.body);
      continue;
    }

    const reservationId = (reserveResponse.body as { id?: string } | null)?.id;
    if (!reservationId) {
      failedCartelas += 1;
      lastStatusCode = 500;
      lastErrorMessage = 'Reserve response missing reservation id';
      continue;
    }

    const confirmResponse = await fetchJson(confirmEndpoint(reservationId), {
      method: 'POST',
      headers: authHeaders(player.token),
    });

    lastStatusCode = confirmResponse.statusCode;
    if (confirmResponse.ok) {
      succeededCartelas += 1;
      continue;
    }

    failedCartelas += 1;
    lastErrorMessage = JSON.stringify(confirmResponse.body);
  }

  const durationMs = Date.now() - start;
  const ok = failedCartelas === 0;

  return {
    label: player.label,
    endpoint: reserveEndpoint(),
    startedAt,
    durationMs,
    ok,
    statusCode: lastStatusCode,
    attemptedCartelas: player.cartelas.length,
    succeededCartelas,
    failedCartelas,
    responseKind: classifyResponseKind(lastStatusCode, ok),
    errorMessage: lastErrorMessage,
  };
}

async function hitRegistrationState(token: string) {
  if (!sessionId) {
    return;
  }

  await fetchJson(`${baseUrl}/games/sessions/${sessionId}/registration-state`, {
    method: 'GET',
    headers: authHeaders(token),
  });
}

function summarizeMetrics(metrics: RequestMetric[], startedAt: number) {
  const durationMs = Date.now() - startedAt;
  const durations = metrics.map((metric) => metric.durationMs).sort((a, b) => a - b);
  const attemptedCartelas = metrics.reduce(
    (sum, metric) => sum + metric.attemptedCartelas,
    0,
  );
  const succeededCartelas = metrics.reduce(
    (sum, metric) => sum + metric.succeededCartelas,
    0,
  );
  const failedCartelas = metrics.reduce(
    (sum, metric) => sum + metric.failedCartelas,
    0,
  );
  const successfulRequests = metrics.filter((metric) => metric.ok).length;
  const conflictRequests = metrics.filter(
    (metric) => metric.responseKind === 'conflict',
  ).length;
  const failedRequests = metrics.filter(
    (metric) => metric.responseKind === 'failure',
  ).length;

  return {
    scenario,
    baseUrl,
    slotId,
    sessionId,
    durationMs,
    players: metrics.length,
    successfulRequests,
    conflictRequests,
    failedRequests,
    attemptedCartelas,
    succeededCartelas,
    failedCartelas,
    latencyMs: {
      min: durations[0] ?? 0,
      p50: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
      max: durations[durations.length - 1] ?? 0,
    },
    errors: metrics
      .filter((metric) => !metric.ok && metric.errorMessage != null)
      .slice(0, 20),
  };
}

async function fetchJson(
  url: string,
  init: RequestInit,
): Promise<{
  ok: boolean;
  statusCode: number;
  body: unknown;
}> {
  const response = await fetch(url, init);
  const text = await response.text();
  const body = safeParseJson(text);

  return {
    ok: response.ok,
    statusCode: response.status,
    body,
  };
}

function classifyResponseKind(
  statusCode: number,
  ok: boolean,
): RequestMetric['responseKind'] {
  if (ok) {
    return 'success';
  }

  if (statusCode === 409 || statusCode === 400) {
    return 'conflict';
  }

  return 'failure';
}

function authHeaders(token: string): HeadersInit {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
}

function bulkEndpoint() {
  return `${baseUrl}/games/slots/${slotId}/register-cartelas-bulk`;
}

function reserveEndpoint(cartelaId?: string) {
  if (scenario !== 'reserve-confirm') {
    return `${baseUrl}/games/slots/${slotId}/register-cartelas-bulk`;
  }

  if (sessionId) {
    return cartelaId == null
      ? `${baseUrl}/games/sessions/${sessionId}/cartelas`
      : `${baseUrl}/games/sessions/${sessionId}/cartelas/${cartelaId}/reserve`;
  }

  return cartelaId == null
    ? `${baseUrl}/games/slots/${slotId}/cartelas`
    : `${baseUrl}/games/slots/${slotId}/cartelas/${cartelaId}/reserve`;
}

function confirmEndpoint(reservationId: string) {
  return `${baseUrl}/games/reservations/${reservationId}/confirm`;
}

function safeParseJson(raw: string): unknown {
  if (!raw.trim()) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function percentile(values: number[], fraction: number) {
  if (values.length === 0) {
    return 0;
  }

  const index = Math.min(
    values.length - 1,
    Math.max(0, Math.ceil(values.length * fraction) - 1),
  );
  return values[index];
}

function delay(ms: number) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function ensureSafeTarget(url: string, allowUnsafe: boolean) {
  if (allowUnsafe) {
    return;
  }

  const normalized = url.toLowerCase();
  const looksSafe =
    normalized.includes('staging') ||
    normalized.includes('localhost') ||
    normalized.includes('127.0.0.1');

  if (!looksSafe) {
    throw new Error(
      `Refusing to run against non-staging target "${url}". Set LOAD_TEST_ALLOW_NON_STAGING=true to override deliberately.`,
    );
  }
}

function parseScenario(value: string | undefined): Scenario {
  if (value == null || value.trim() === '') {
    return 'bulk';
  }

  if (value === 'bulk' || value === 'reserve-confirm') {
    return value;
  }

  throw new Error(
    `Unsupported LOAD_TEST_SCENARIO "${value}". Use "bulk" or "reserve-confirm".`,
  );
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  if (value == null || value.trim() === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received "${value}".`);
  }

  return parsed;
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Set ${name}.`);
  }

  return value;
}

void main().catch((error) => {
  console.error('[load-test] failed', error);
  process.exitCode = 1;
});
