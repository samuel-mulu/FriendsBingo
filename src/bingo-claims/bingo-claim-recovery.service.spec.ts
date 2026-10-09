import { ConfigService } from '@nestjs/config';
import { BingoClaimRecoveryService } from './bingo-claim-recovery.service';
import { envValidationSchema } from '../config/env.validation';

describe('CHECKING recovery worker lifecycle', () => {
  let recover: jest.Mock;
  let worker: BingoClaimRecoveryService;

  function create(enabled?: boolean) {
    recover = jest.fn().mockResolvedValue({ candidates: 0, recovered: 0 });
    worker = new BingoClaimRecoveryService(
      new ConfigService({ BINGO_CLAIM_RECOVERY_ENABLED: enabled }),
      { recoverOrphanedCheckingClaims: recover } as never,
    );
    jest.spyOn((worker as any).logger, 'error').mockImplementation(() => {});
    return worker;
  }

  beforeEach(() => jest.useFakeTimers());
  afterEach(async () => {
    await worker?.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('environment defaults recovery to false and parses explicit true', () => {
    const flag = envValidationSchema.extract('BINGO_CLAIM_RECOVERY_ENABLED');
    expect(flag.validate(undefined).value).toBe(false);
    expect(flag.validate('false').value).toBe(false);
    expect(flag.validate('true').value).toBe(true);
  });

  it.each([undefined, false])(
    'disabled (%s): no startup scan or timer',
    async (enabled) => {
      create(enabled).onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(20_000);
      expect(recover).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it('enabled: startup scan, then one scan every five seconds', async () => {
    create(true).onApplicationBootstrap();
    expect(recover).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(4999);
    expect(recover).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(recover).toHaveBeenCalledTimes(2);
  });

  it('overlapping timer ticks do not start competing scans', async () => {
    create(true);
    let release!: () => void;
    recover.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(15_000);
    expect(recover).toHaveBeenCalledTimes(1);
    release();
    await jest.advanceTimersByTimeAsync(5000);
    expect(recover).toHaveBeenCalledTimes(2);
  });

  it('shutdown clears timer, waits for in-flight scan and starts no further work', async () => {
    create(true);
    let release!: () => void;
    recover.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    worker.onApplicationBootstrap();
    let stopped = false;
    const shutdown = worker.onModuleDestroy().then(() => {
      stopped = true;
    });
    await jest.advanceTimersByTimeAsync(15_000);
    expect(stopped).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
    release();
    await shutdown;
    await jest.advanceTimersByTimeAsync(15_000);
    expect(stopped).toBe(true);
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it('scan failure is caught and the next tick retries', async () => {
    create(true);
    recover.mockRejectedValueOnce(new Error('database unavailable'));
    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(5000);
    expect(recover).toHaveBeenCalledTimes(2);
    expect((worker as any).logger.error).toHaveBeenCalledTimes(1);
  });
});
