import { GameCategory, GameOperationMode, GameStatus } from '@prisma/client';
import { AutoCallService } from './auto-call.service';

describe('AutoCallService - Crash Recovery', () => {
  let service: AutoCallService;
  let prisma: any;
  let gameTimingConfigService: any;
  let calledNumbersService: any;

  beforeEach(() => {
    prisma = {
      gameSession: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    gameTimingConfigService = {
      getAutoCallIntervalMs: jest.fn().mockResolvedValue(5000),
      getAutoCallIntervalSeconds: jest.fn().mockResolvedValue(5),
    };
    calledNumbersService = {
      callRandomNumber: jest.fn().mockResolvedValue({ number: 42, order: 1 }),
      callRandomNumberForAutoCall: jest.fn(),
    };

    service = new AutoCallService(
      prisma,
      gameTimingConfigService,
      calledNumbersService,
      undefined,
      undefined,
    );
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('recovers orphaned sessions in PLAYING with autoCallEnabled=false and calls first ball if 0 called', async () => {
    const orphanedSession = {
      id: 'session-orphan-1',
      gameSlotId: 'slot-1',
      autoCallIntervalMs: 8000,
      gameSlot: {
        category: GameCategory.NORMAL,
        operationMode: GameOperationMode.AUTO,
        autoCallIntervalSeconds: 8,
      },
      _count: {
        calledNumbers: 0,
      },
    };

    prisma.gameSession.findMany.mockResolvedValueOnce([orphanedSession]);
    prisma.gameSession.findUnique.mockResolvedValueOnce({
      id: 'session-orphan-1',
      status: GameStatus.PLAYING,
      gameSlotId: 'slot-1',
      autoCallIntervalMs: 8000,
      _count: { calledNumbers: 0 },
    });

    const recoveredCount = await service.recoverOrphanedAutoPlayingSessions();

    expect(recoveredCount).toBe(1);
    expect(prisma.gameSession.update).toHaveBeenCalledWith({
      where: { id: 'session-orphan-1' },
      data: { autoCallIntervalMs: 8000 },
    });
    // First ball should be called immediately
    expect(calledNumbersService.callRandomNumber).toHaveBeenCalledWith('session-orphan-1');
  });

  it('does nothing when no orphaned sessions exist', async () => {
    prisma.gameSession.findMany.mockResolvedValueOnce([]);

    const recoveredCount = await service.recoverOrphanedAutoPlayingSessions();

    expect(recoveredCount).toBe(0);
    expect(prisma.gameSession.update).not.toHaveBeenCalled();
    expect(calledNumbersService.callRandomNumber).not.toHaveBeenCalled();
  });
});
