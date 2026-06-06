import { GameStatus } from '@prisma/client';
import {
  serializeGameSession,
  serializeGameSlot,
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
    expect(payload).not.toHaveProperty('companyFeePerCartela');
    expect(payload).not.toHaveProperty('companyRevenue');
  });

  it('removes company financial fields from player session payloads', () => {
    const payload = toPlayerGameSession(serializeGameSession(session as never));

    expect(payload.entryFee).toBe('10');
    expect(payload.prizeAmount).toBe('16');
    expect(payload.prizePerCartela).toBe('8');
    expect(payload).not.toHaveProperty('companyFeePerCartela');
    expect(payload).not.toHaveProperty('companyRevenue');
  });
});
