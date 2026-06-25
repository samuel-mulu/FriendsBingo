import { GameCategory, GameStatus, Prisma } from '@prisma/client';
import {
  buildRegisteredCartelasSummary,
  serializeGameSession,
  serializeGameSlot,
  serializeWinnerPayoutsSummary,
  toPlayerGameSession,
  toPlayerGameSlot,
} from './games.mapper';

describe('games.mapper player payloads', () => {
  const slot = {
    id: 'slot-1',
    staticCode: 'MANUAL-S1',
    name: 'Manual',
    gameType: 'MANUAL',
    gameRuleId: 'rule-1',
    status: GameStatus.NEXT,
    entryFee: { toString: () => '10' },
    prizePerCartela: { toString: () => '8' },
    category: GameCategory.BIG_GAME,
    fixedPrizeAmount: { toString: () => '5000' },
    maxCartelasPerPlayer: 25,
    sortOrder: 1,
    createdAt: new Date('2026-06-06T09:00:00.000Z'),
    updatedAt: new Date('2026-06-06T09:00:00.000Z'),
    gameRule: {
      id: 'rule-1',
      key: 'MANUAL',
      name: 'Manual',
      description: null,
      isActive: true,
      sortOrder: 1,
    },
    sessions: [],
  };

  const session = {
    id: 'session-1',
    gameSlotId: 'slot-1',
    playCode: 'BINGO-ABC123',
    entryFee: { toString: () => '10' },
    prizePerCartela: { toString: () => '8' },
    companyFeePerCartela: { toString: () => '2' },
    prizeAmount: { toString: () => '16' },
    companyRevenue: { toString: () => '4' },
    status: GameStatus.PLAYING,
    registrationOpensAt: new Date('2026-06-06T08:00:00.000Z'),
    scheduledStartAt: new Date('2026-06-06T10:30:00.000Z'),
    startedAt: new Date('2026-06-06T10:00:00.000Z'),
    finishedAt: null,
    winnerCartelaId: null,
    createdAt: new Date('2026-06-06T10:00:00.000Z'),
    updatedAt: new Date('2026-06-06T10:00:00.000Z'),
    gameSlot: slot,
    _count: {
      gameCartelas: 2,
      calledNumbers: 5,
    },
  };

  it('removes company financial fields from player slot payloads', () => {
    const payload = toPlayerGameSlot(serializeGameSlot(slot));

    expect(payload.entryFee).toBe('10');
    expect(payload.prizePerCartela).toBe('8');
    expect(payload.prizeAmount).toBe('0');
    expect(payload.isBigGame).toBe(true);
    expect(payload).not.toHaveProperty('companyFeePerCartela');
    expect(payload).not.toHaveProperty('companyRevenue');
  });

  it('removes company financial fields from player session payloads', () => {
    const payload = toPlayerGameSession(serializeGameSession(session as never));

    expect(payload.entryFee).toBe('10');
    expect(payload.prizeAmount).toBe('16');
    expect(payload.prizePerCartela).toBe('8');
    expect(payload.registrationOpensAt).toEqual(
      new Date('2026-06-06T08:00:00.000Z'),
    );
    expect(payload.isBigGame).toBe(true);
    expect(payload).not.toHaveProperty('companyFeePerCartela');
    expect(payload).not.toHaveProperty('companyRevenue');
  });

  it('returns exact split amounts and ME/OTHER ownership for winner payouts', () => {
    const winners = [
      {
        id: 'gc-1',
        cartelaId: 'cartela-1',
        userId: 'user-1',
        status: 'WINNER',
        isWinner: true,
        cartela: { id: 'cartela-1', number: 7 },
      },
      {
        id: 'gc-2',
        cartelaId: 'cartela-2',
        userId: 'user-2',
        status: 'WINNER',
        isWinner: true,
        cartela: { id: 'cartela-2', number: 12 },
      },
      {
        id: 'gc-3',
        cartelaId: 'cartela-3',
        userId: 'user-3',
        status: 'WINNER',
        isWinner: true,
        cartela: { id: 'cartela-3', number: 19 },
      },
    ] as never;

    const summary = serializeWinnerPayoutsSummary(
      winners,
      new Prisma.Decimal('10.00'),
      'user-2',
    );

    expect(summary).toEqual([
      {
        cartelaId: 'cartela-1',
        cartelaNumber: 7,
        amount: '3.34',
        owner: 'OTHER',
      },
      {
        cartelaId: 'cartela-2',
        cartelaNumber: 12,
        amount: '3.33',
        owner: 'ME',
      },
      {
        cartelaId: 'cartela-3',
        cartelaNumber: 19,
        amount: '3.33',
        owner: 'OTHER',
      },
    ]);
    expect(JSON.stringify(summary)).not.toContain('user-1');
    expect(JSON.stringify(summary)).not.toContain('user-2');
    expect(JSON.stringify(summary)).not.toContain('user-3');
  });

  it('builds guest cartela summary with OTHER and RESERVED_OTHER only', () => {
    const summary = buildRegisteredCartelasSummary(
      [
        {
          id: 'gc-1',
          cartelaId: 'cartela-1',
          userId: 'user-1',
          status: 'REGISTERED',
          isWinner: false,
          cartela: { id: 'cartela-1', number: 7 },
        },
      ] as never,
      [
        {
          cartelaId: 'cartela-2',
          userId: 'user-2',
          expiresAt: new Date('2026-06-06T10:01:00.000Z'),
          cartela: { id: 'cartela-2', number: 12 },
        },
      ] as never,
    );

    expect(summary).toEqual([
      {
        cartelaId: 'cartela-1',
        cartelaNumber: 7,
        owner: 'OTHER',
        status: 'REGISTERED',
      },
      {
        cartelaId: 'cartela-2',
        cartelaNumber: 12,
        owner: 'RESERVED_OTHER',
        status: 'RESERVED',
        expiresAt: '2026-06-06T10:01:00.000Z',
      },
    ]);
  });
});
