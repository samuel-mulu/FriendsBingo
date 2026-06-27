import { Test, TestingModule } from '@nestjs/testing';
import { GameCategory, GameOperationMode, GameStatus } from '@prisma/client';
import { GameLifecycleDebugLogger } from './game-lifecycle-debug-logger.service';
import { GameOperationInvariantsService } from './game-operation-invariants.service';
import { GameOperationRepairService } from './game-operation-repair.service';
import { GameLifecycleService } from './game-lifecycle.service';
import { PostGameRegistrationOpenerService } from './post-game-registration-opener.service';
import { PrismaService } from '../prisma/prisma.service';
import { GameTimingConfigService } from '../game-timing-config/game-timing-config.service';
import { OperationsCacheService } from './operations-cache.service';
import { AutoReadyCountdownRepairService } from './auto-ready-countdown-repair.service';
import { RealtimeService } from '../realtime/realtime.service';
import { GamePushNotificationsService } from '../notifications/game-push-notifications.service';

/**
 * Tests that verify GameLifecycleDebugLogger is properly integrated
 * into the game operations lifecycle.
 * 
 * These tests use spies to verify logger methods are called
 * without requiring actual log output.
 */
describe('GameLifecycleDebugLogger Integration', () => {
  let lifecycleLogger: GameLifecycleDebugLogger;
  let postGameOpener: PostGameRegistrationOpenerService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostGameRegistrationOpenerService,
        GameLifecycleDebugLogger,
        GameOperationInvariantsService,
        GameOperationRepairService,
        {
          provide: GameLifecycleService,
          useValue: {
            cancelSession: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            $transaction: jest.fn((callback) => callback(prisma)),
            gameSession: {
              findFirst: jest.fn(),
              findMany: jest.fn().mockResolvedValue([]),
              create: jest.fn(),
            },
            gameSlot: {
              findMany: jest.fn(),
              findUnique: jest.fn().mockResolvedValue({
                id: 'slot-1',
                status: GameStatus.NEXT,
                category: GameCategory.NORMAL,
                operationMode: GameOperationMode.AUTO,
              }),
              update: jest.fn(),
            },
          },
        },
        {
          provide: GameTimingConfigService,
          useValue: {
            getFinishedResultDisplaySeconds: jest.fn().mockResolvedValue(10),
            getRegistrationDurationSeconds: jest.fn().mockResolvedValue(60),
            getAutoCallIntervalSeconds: jest.fn().mockResolvedValue(5),
          },
        },
        {
          provide: OperationsCacheService,
          useValue: {
            invalidate: jest.fn(),
          },
        },
        {
          provide: AutoReadyCountdownRepairService,
          useValue: {
            ensureAutoReadySessionHasCountdown: jest.fn(),
          },
        },
        {
          provide: RealtimeService,
          useValue: {
            emitToPublicGames: jest.fn(),
            emitToAdmin: jest.fn(),
            emitToSession: jest.fn(),
            emitGameOperationUpdate: jest.fn(),
          },
        },
        {
          provide: GamePushNotificationsService,
          useValue: {
            notifyRegistrationOpened: jest.fn(),
          },
        },
      ],
    }).compile();

    lifecycleLogger = module.get<GameLifecycleDebugLogger>(
      GameLifecycleDebugLogger,
    );
    postGameOpener = module.get<PostGameRegistrationOpenerService>(
      PostGameRegistrationOpenerService,
    );
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('PostGameRegistrationOpenerService Integration', () => {
    it('logs session_created when AUTO READY session is created', async () => {
      const sessionCreatedSpy = jest.spyOn(lifecycleLogger, 'sessionCreated');
      const queueHeadSelectedSpy = jest.spyOn(
        lifecycleLogger,
        'queueHeadSelected',
      );
      const registrationOpenedSpy = jest.spyOn(
        lifecycleLogger,
        'registrationOpened',
      );

      // Mock: no active session
      (prisma.gameSession.findFirst as jest.Mock).mockResolvedValue(null);

      // Mock: queue has AUTO slot
      (prisma.gameSlot.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'slot-1',
          sortOrder: 1,
          category: GameCategory.NORMAL,
          operationMode: GameOperationMode.AUTO,
          fixedPrizeAmount: null,
          entryFee: '10',
          prizePerCartela: '8',
          registrationDurationSeconds: 60,
        },
      ]);

      // Mock: session created
      (prisma.gameSession.create as jest.Mock).mockResolvedValue({
        id: 'session-1',
        gameSlotId: 'slot-1',
        status: GameStatus.READY,
        playCode: 'ABC123',
        scheduledStartAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        entryFee: { toString: () => '10' },
        prizePerCartela: { toString: () => '8' },
        companyFeePerCartela: { toString: () => '2' },
        prizeAmount: { toString: () => '0' },
        companyRevenue: { toString: () => '0' },
        _count: {
          gameCartelas: 0,
          calledNumbers: 0,
        },
        gameSlot: {
          id: 'slot-1',
          category: GameCategory.NORMAL,
          operationMode: GameOperationMode.AUTO,
          fixedPrizeAmount: null,
          maxCartelasPerPlayer: null,
          status: GameStatus.NEXT,
          name: 'Test Game',
          gameType: 'test',
          sortOrder: 1,
          entryFee: { toString: () => '10' },
          prizePerCartela: { toString: () => '8' },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      await postGameOpener.openNextAutoQueueRegistration();

      // Verify queue head selected
      expect(queueHeadSelectedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          slotId: 'slot-1',
          category: GameCategory.NORMAL,
          operationMode: GameOperationMode.AUTO,
          reason: 'registration_open',
        }),
      );

      // Verify session created
      expect(sessionCreatedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-1',
          slotId: 'slot-1',
          slotStatus: GameStatus.NEXT,
          sessionStatus: GameStatus.READY,
          category: GameCategory.NORMAL,
          operationMode: GameOperationMode.AUTO,
          reason: 'post_game_opener',
        }),
      );

      // Verify registration opened
      expect(registrationOpenedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-1',
          slotId: 'slot-1',
          category: GameCategory.NORMAL,
          operationMode: GameOperationMode.AUTO,
          reason: 'scheduler_tick',
        }),
      );
    });

    it('does not log when no AUTO queue head exists', async () => {
      const sessionCreatedSpy = jest.spyOn(lifecycleLogger, 'sessionCreated');

      // Mock: no active session
      (prisma.gameSession.findFirst as jest.Mock).mockResolvedValue(null);

      // Mock: queue is empty
      (prisma.gameSlot.findMany as jest.Mock).mockResolvedValue([]);

      const result = await postGameOpener.openNextAutoQueueRegistration();

      expect(result).toBe(false);
      expect(sessionCreatedSpy).not.toHaveBeenCalled();
    });

    it('does not log when active session exists', async () => {
      const sessionCreatedSpy = jest.spyOn(lifecycleLogger, 'sessionCreated');

      // Mock: active session exists
      (prisma.gameSession.findFirst as jest.Mock).mockResolvedValue({
        id: 'active-session',
      });

      const result = await postGameOpener.openNextAutoQueueRegistration();

      expect(result).toBe(false);
      expect(sessionCreatedSpy).not.toHaveBeenCalled();
    });
  });

  describe('Logger Enabled/Disabled', () => {
    it('respects GAME_LIFECYCLE_DEBUG environment variable', () => {
      // Logger is enabled in test environment by default
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      process.env.GAME_LIFECYCLE_DEBUG = 'false';

      const prodLogger = new GameLifecycleDebugLogger();
      const spy = jest.spyOn(prodLogger['logger'], 'log');

      prodLogger.sessionCreated({
        sessionId: 'test',
        slotId: 'test',
        slotStatus: GameStatus.NEXT,
        sessionStatus: GameStatus.READY,
        category: GameCategory.NORMAL,
        operationMode: GameOperationMode.AUTO,
        reason: 'post_game_opener',
      });

      // Should not log in production when GAME_LIFECYCLE_DEBUG=false
      expect(spy).not.toHaveBeenCalled();

      process.env.NODE_ENV = originalEnv;
      delete process.env.GAME_LIFECYCLE_DEBUG;
    });

    it('logs in development environment', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const devLogger = new GameLifecycleDebugLogger();
      const spy = jest.spyOn(devLogger['logger'], 'log');

      devLogger.sessionCreated({
        sessionId: 'test',
        slotId: 'test',
        slotStatus: GameStatus.NEXT,
        sessionStatus: GameStatus.READY,
        category: GameCategory.NORMAL,
        operationMode: GameOperationMode.AUTO,
        reason: 'post_game_opener',
      });

      // Should log in development
      expect(spy).toHaveBeenCalled();

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('Log Format', () => {
    it('formats session_created log correctly', () => {
      // Force enable logging for this test
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      // Create a fresh logger instance for this test
      const testLogger = new GameLifecycleDebugLogger();
      const spy = jest.spyOn(testLogger['logger'], 'log');

      testLogger.sessionCreated({
        sessionId: 'session-123',
        slotId: 'slot-456',
        slotStatus: GameStatus.NEXT,
        sessionStatus: GameStatus.READY,
        category: GameCategory.NORMAL,
        operationMode: GameOperationMode.AUTO,
        reason: 'post_game_opener',
        scheduledStartAt: new Date('2026-06-27T10:30:00.000Z'),
      });

      const logCall = spy.mock.calls[0]?.[0];
      expect(logCall).toBeDefined();
      expect(logCall).toContain('event=session_created');
      expect(logCall).toContain('slotId=slot-456');
      expect(logCall).toContain('sessionId=session-123');
      expect(logCall).toContain('slotStatus=NEXT');
      expect(logCall).toContain('sessionStatus=READY');
      expect(logCall).toContain('category=NORMAL');
      expect(logCall).toContain('operationMode=AUTO');
      expect(logCall).toContain('reason=post_game_opener');
      expect(logCall).toContain('scheduledStartAt=2026-06-27T10:30:00.000Z');

      process.env.NODE_ENV = originalEnv;
    });

    it('does not include personal data in logs', () => {
      // Force enable logging for this test
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      // Create a fresh logger instance for this test
      const testLogger = new GameLifecycleDebugLogger();
      const spy = jest.spyOn(testLogger['logger'], 'log');

      testLogger.sessionCreated({
        sessionId: 'session-123',
        slotId: 'slot-456',
        slotStatus: GameStatus.NEXT,
        sessionStatus: GameStatus.READY,
        category: GameCategory.NORMAL,
        operationMode: GameOperationMode.AUTO,
        reason: 'post_game_opener',
      });

      const logCall = spy.mock.calls[0]?.[0];
      expect(logCall).toBeDefined();

      // Should NOT contain user IDs, wallet amounts, etc.
      expect(logCall).not.toContain('userId');
      expect(logCall).not.toContain('walletId');
      expect(logCall).not.toContain('amount');
      expect(logCall).not.toContain('balance');

      process.env.NODE_ENV = originalEnv;
    });
  });
});
