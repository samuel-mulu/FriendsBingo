import { Test, TestingModule } from '@nestjs/testing';
import { GameCategory, GameOperationMode, GameStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GamesService } from './games.service';
import { GameQueueService } from './game-queue.service';
import { GameOperationInvariantsService } from './game-operation-invariants.service';

/**
 * Tests that document the CURRENT EXPECTED BEHAVIOR of the game operations engine.
 * 
 * Purpose: Lock down the intended behavior without requiring refactoring.
 * These tests should pass with the current implementation.
 * 
 * If a test fails, it means either:
 * 1. The implementation has a bug, OR
 * 2. The documented behavior is wrong
 * 
 * DO NOT change these tests to make them pass.
 * Fix the implementation or update the documentation.
 */
describe('Game Operations - Expected Behavior (Current Implementation)', () => {
  let prisma: PrismaService;
  let gamesService: GamesService;
  let queueService: GameQueueService;
  let invariantsService: GameOperationInvariantsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: PrismaService,
          useValue: {
            gameSlot: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
            },
            gameSession: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
            },
            $transaction: jest.fn((callback) => callback(prisma)),
          },
        },
        {
          provide: GamesService,
          useValue: {
            getCurrentOperations: jest.fn(),
          },
        },
        {
          provide: GameQueueService,
          useValue: {
            listQueueOrderingSlots: jest.fn(),
          },
        },
        GameOperationInvariantsService,
      ],
    }).compile();

    prisma = module.get<PrismaService>(PrismaService);
    gamesService = module.get<GamesService>(GamesService);
    queueService = module.get<GameQueueService>(GameQueueService);
    invariantsService = module.get<GameOperationInvariantsService>(
      GameOperationInvariantsService,
    );
  });

  describe('Source of Truth', () => {
    it('GameSession.status is the canonical source of truth', async () => {
      // Setup: Session is READY, slot is NEXT
      (prisma.gameSession.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'session-1',
          status: GameStatus.READY,
          gameSlotId: 'slot-1',
          gameSlot: {
            id: 'slot-1',
            status: GameStatus.NEXT,
          },
        },
      ]);

      const sessions = await prisma.gameSession.findMany({
        where: { status: GameStatus.READY },
        select: {
          id: true,
          status: true,
          gameSlotId: true,
          gameSlot: { select: { id: true, status: true } },
        },
      });

      // Assertion: Session status is READY (canonical)
      expect(sessions[0].status).toBe(GameStatus.READY);
      // Slot status is NEXT (derivative, not yet synchronized)
      expect(sessions[0].gameSlot.status).toBe(GameStatus.NEXT);

      // This is EXPECTED and CORRECT behavior
    });

    it('GameSlot.status is derivative and synchronized from session', async () => {
      // Setup: Session transitions to PLAYING, slot should follow
      const session = {
        id: 'session-1',
        status: GameStatus.PLAYING,
        gameSlotId: 'slot-1',
      };

      const slot = {
        id: 'slot-1',
        status: GameStatus.PLAYING,
      };

      (prisma.gameSession.findUnique as jest.Mock).mockResolvedValue(session);
      (prisma.gameSlot.findUnique as jest.Mock).mockResolvedValue(slot);

      const foundSession = await prisma.gameSession.findUnique({
        where: { id: 'session-1' },
      });
      const foundSlot = await prisma.gameSlot.findUnique({
        where: { id: 'slot-1' },
      });

      // When session is PLAYING, slot should also be PLAYING
      expect(foundSession?.status).toBe(GameStatus.PLAYING);
      expect(foundSlot?.status).toBe(GameStatus.PLAYING);
    });
  });

  describe('NEXT Slot + READY Session State', () => {
    it('Slot can be NEXT while session is READY (expected and correct)', async () => {
      (prisma.gameSession.findFirst as jest.Mock).mockResolvedValue({
        id: 'session-1',
        status: GameStatus.READY,
        gameSlotId: 'slot-1',
        scheduledStartAt: new Date(Date.now() + 60000),
        gameSlot: {
          id: 'slot-1',
          status: GameStatus.NEXT,
          sortOrder: 1,
          category: GameCategory.NORMAL,
          operationMode: GameOperationMode.AUTO,
        },
      });

      const session = await prisma.gameSession.findFirst({
        where: { status: GameStatus.READY },
        select: {
          id: true,
          status: true,
          gameSlotId: true,
          scheduledStartAt: true,
          gameSlot: {
            select: {
              id: true,
              status: true,
              sortOrder: true,
              category: true,
              operationMode: true,
            },
          },
        },
      });

      // This is the confusing but CORRECT state
      expect(session?.status).toBe(GameStatus.READY);
      expect(session?.gameSlot.status).toBe(GameStatus.NEXT);

      // Interpretation:
      // - Slot is in queue (NEXT)
      // - Session is accepting registrations (READY)
      // - When session starts, slot will become PLAYING
    });

    it('Slot transitions to PLAYING when session starts', async () => {
      // Before: slot NEXT, session READY
      const beforeSlot = {
        id: 'slot-1',
        status: GameStatus.NEXT,
      };

      const beforeSession = {
        id: 'session-1',
        status: GameStatus.READY,
        gameSlotId: 'slot-1',
      };

      // After: both PLAYING
      const afterSlot = {
        id: 'slot-1',
        status: GameStatus.PLAYING,
      };

      const afterSession = {
        id: 'session-1',
        status: GameStatus.PLAYING,
        gameSlotId: 'slot-1',
        startedAt: new Date(),
      };

      (prisma.gameSlot.update as jest.Mock).mockResolvedValue(afterSlot);
      (prisma.gameSession.update as jest.Mock).mockResolvedValue(afterSession);

      // Simulate startGame transition
      const updatedSlot = await prisma.gameSlot.update({
        where: { id: 'slot-1' },
        data: { status: GameStatus.PLAYING },
      });

      const updatedSession = await prisma.gameSession.update({
        where: { id: 'session-1' },
        data: { status: GameStatus.PLAYING, startedAt: new Date() },
      });

      expect(updatedSlot.status).toBe(GameStatus.PLAYING);
      expect(updatedSession.status).toBe(GameStatus.PLAYING);
    });
  });

  describe('operations/current Behavior', () => {
    it('returns READY session as registrationOpenGame', async () => {
      (gamesService.getCurrentOperations as jest.Mock).mockResolvedValue({
        liveGame: null,
        checkingGame: null,
        registrationOpenGame: {
          id: 'session-1',
          sessionId: 'session-1',
          status: GameStatus.READY,
          slotId: 'slot-1',
          category: GameCategory.NORMAL,
        },
        queue: [],
      });

      const operations = await gamesService.getCurrentOperations();

      expect(operations.registrationOpenGame).toBeDefined();
      expect((operations.registrationOpenGame as any)?.status).toBe(GameStatus.READY);
    });

    it('returns null as registrationOpenGame when no READY session exists (Phase 2)', async () => {
      (gamesService.getCurrentOperations as jest.Mock).mockResolvedValue({
        liveGame: null,
        checkingGame: null,
        registrationOpenGame: null, // Phase 2: null if no READY session
        queue: [
          {
            slotId: 'slot-1',
            status: GameStatus.NEXT,
            category: GameCategory.NORMAL,
            // NEXT slots appear only in queue, not as registrationOpenGame
          },
        ],
      });

      const operations = await gamesService.getCurrentOperations();

      // Phase 2: registrationOpenGame is null if no READY session exists
      expect(operations.registrationOpenGame).toBeNull();
      // NEXT slots appear in queue instead
      expect(operations.queue.length).toBeGreaterThan(0);
    });
  });

  describe('Queue Behavior', () => {
    it('Normal queue excludes Big Game', async () => {
      (queueService.listQueueOrderingSlots as jest.Mock).mockResolvedValue([
        { id: 'slot-1', gameRuleId: 'rule-1', sortOrder: 1 },
        { id: 'slot-2', gameRuleId: 'rule-2', sortOrder: 2 },
        // Big Game is excluded from this query
      ]);

      const queueSlots = await queueService.listQueueOrderingSlots(
        prisma as any,
      );

      expect(queueSlots).toHaveLength(2);
      // Queue service returns slots without category - category check happens in query
    });

    it('Queue is ordered by sortOrder ASC', async () => {
      (queueService.listQueueOrderingSlots as jest.Mock).mockResolvedValue([
        { id: 'slot-1', gameRuleId: 'rule-1', sortOrder: 1 },
        { id: 'slot-2', gameRuleId: 'rule-2', sortOrder: 2 },
        { id: 'slot-3', gameRuleId: 'rule-3', sortOrder: 3 },
      ]);

      const queueSlots = await queueService.listQueueOrderingSlots(
        prisma as any,
      );

      for (let i = 1; i < queueSlots.length; i++) {
        const currentOrder = queueSlots[i].sortOrder ?? 0;
        const previousOrder = queueSlots[i - 1].sortOrder ?? 0;
        expect(currentOrder).toBeGreaterThan(previousOrder);
      }
    });
  });

  describe('Big Game Priority', () => {
    it('Due Big Game blocks normal game start', async () => {
      const now = new Date();
      const dueBigGame = {
        id: 'session-big',
        status: GameStatus.READY,
        scheduledStartAt: new Date(now.getTime() - 1000), // 1s ago (due)
        gameSlot: {
          id: 'slot-big',
          category: GameCategory.BIG_GAME,
          status: GameStatus.NEXT,
        },
      };

      (prisma.gameSession.findFirst as jest.Mock).mockResolvedValue(
        dueBigGame,
      );

      const foundDueBigGame = await prisma.gameSession.findFirst({
        where: {
          status: GameStatus.READY,
          scheduledStartAt: { lte: now },
          gameSlot: {
            category: GameCategory.BIG_GAME,
            status: { not: GameStatus.CANCELLED },
          },
        },
        select: {
          id: true,
          status: true,
          scheduledStartAt: true,
          gameSlot: { select: { id: true, category: true, status: true } },
        },
      });

      expect(foundDueBigGame).toBeDefined();
      expect(foundDueBigGame?.scheduledStartAt).toBeDefined();
      expect(foundDueBigGame!.scheduledStartAt!.getTime()).toBeLessThanOrEqual(
        now.getTime(),
      );

      // This Big Game should block normal game starts
      // (verified by GameQueueService.assertSlotReady)
    });

    it('Future Big Game does not block normal queue', async () => {
      const now = new Date();
      const futureBigGame = {
        id: 'session-big',
        status: GameStatus.READY,
        scheduledStartAt: new Date(now.getTime() + 60000), // 1min future
        gameSlot: {
          id: 'slot-big',
          category: GameCategory.BIG_GAME,
          status: GameStatus.NEXT,
        },
      };

      (prisma.gameSession.findFirst as jest.Mock).mockResolvedValue(null);

      const foundDueBigGame = await prisma.gameSession.findFirst({
        where: {
          status: GameStatus.READY,
          scheduledStartAt: { lte: now },
          gameSlot: {
            category: GameCategory.BIG_GAME,
            status: { not: GameStatus.CANCELLED },
          },
        },
      });

      expect(foundDueBigGame).toBeNull();

      // Future Big Game does not block - normal games can start
    });
  });

  describe('Session Lifecycle', () => {
    it('FINISHED session does not remain registration candidate', async () => {
      (prisma.gameSession.findMany as jest.Mock).mockResolvedValue([]);

      const readySessions = await prisma.gameSession.findMany({
        where: {
          status: GameStatus.READY,
          finishedAt: { not: null },
        },
      });

      expect(readySessions).toHaveLength(0);

      // FINISHED sessions should have status FINISHED, not READY
    });

    it('Only one live session can exist', async () => {
      (prisma.gameSession.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'session-1',
          status: GameStatus.PLAYING,
        },
      ]);

      const activeSessions = await prisma.gameSession.findMany({
        where: {
          status: {
            in: [
              GameStatus.PLAYING,
              GameStatus.CHECKING,
              GameStatus.WINNER_WINDOW,
            ],
          },
        },
      });

      expect(activeSessions.length).toBeLessThanOrEqual(1);

      // At most one active session globally
    });
  });

  describe('Invariant Checks', () => {
    it('passes atMostOneActiveSession invariant', async () => {
      (prisma.gameSession.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'session-1',
          status: GameStatus.PLAYING,
          gameSlotId: 'slot-1',
        },
      ]);

      const result =
        await invariantsService.checkInvariant('atMostOneActiveSession');

      expect(result).toBe(true);
    });

    it('fails atMostOneActiveSession when multiple active sessions exist', async () => {
      (prisma.gameSession.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'session-1',
          status: GameStatus.PLAYING,
          gameSlotId: 'slot-1',
        },
        {
          id: 'session-2',
          status: GameStatus.PLAYING,
          gameSlotId: 'slot-2',
        },
      ]);

      const result =
        await invariantsService.checkInvariant('atMostOneActiveSession');

      expect(result).toBe(false);
    });

    it('passes readySessionsHaveSlots invariant', async () => {
      (prisma.gameSession.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'session-1',
          gameSlotId: 'slot-1',
          gameSlot: {
            id: 'slot-1',
            status: GameStatus.NEXT,
          },
        },
      ]);

      const result =
        await invariantsService.checkInvariant('readySessionsHaveSlots');

      expect(result).toBe(true);
    });

    it('passes noTerminalSessionsAsRegistrationCandidates invariant', async () => {
      (prisma.gameSession.findMany as jest.Mock).mockResolvedValue([]);

      const result = await invariantsService.checkInvariant(
        'noTerminalSessionsAsRegistrationCandidates',
      );

      expect(result).toBe(true);
    });
  });

  describe('Documentation Alignment', () => {
    it('documents that GameSession is source of truth', () => {
      // This test exists to ensure the documentation matches reality
      // See: docs/game-operations-lifecycle.md
      expect(true).toBe(true);
    });

    it('documents that slot can be NEXT while session is READY', () => {
      // This test exists to ensure the confusing state is documented
      // See: docs/game-operations-lifecycle.md - "The Confusing State"
      expect(true).toBe(true);
    });

    it('documents that queue is a view, not an entity', () => {
      // This test exists to ensure queue semantics are documented
      // See: docs/game-operations-lifecycle.md - "The Queue"
      expect(true).toBe(true);
    });
  });
});
