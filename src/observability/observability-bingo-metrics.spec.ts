import { ObservabilityService } from './observability.service';
import { RequestContextService } from './request-context.service';

describe('ObservabilityService bingo/winner metrics', () => {
  it('records low-cardinality bingo claim metrics', async () => {
    const service = new ObservabilityService(new RequestContextService());
    service.recordBingoClaim({
      status: 'VALID',
      branch: 'accept',
      totalHttpMs: 120,
      transactionMs: 40,
      reasonCode: null,
    });
    service.recordBingoClaim({
      status: 'FAILED',
      branch: 'infra',
      totalHttpMs: 80,
      transactionMs: 10,
      reasonCode: 'DB_TIMEOUT',
    });
    service.recordSocketRoomJoinFailure();
    service.recordWinnerWindowFinalization({
      durationMs: 250,
      deadlineLagMs: 900,
      result: 'success',
    });

    const metrics = await service.getMetrics();
    expect(metrics).toContain('friends_bingo_bingo_claims_total');
    expect(metrics).toContain('friends_bingo_bingo_claim_duration_seconds');
    expect(metrics).toContain(
      'friends_bingo_bingo_claim_transaction_duration_seconds',
    );
    expect(metrics).toContain('friends_bingo_bingo_claim_failures_total');
    expect(metrics).toContain('friends_bingo_socket_room_join_failures_total');
    expect(metrics).toContain(
      'friends_bingo_winner_window_finalization_duration_seconds',
    );
    expect(metrics).toContain('friends_bingo_winner_window_deadline_lag_seconds');
  });
});
