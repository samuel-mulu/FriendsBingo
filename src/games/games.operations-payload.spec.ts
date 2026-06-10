import { GameCartelaStatus } from '@prisma/client';
import { buildRegisteredCartelasSummary } from './games.mapper';

function buildMockRegistrations(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `gc-${index}`,
    cartelaId: `cartela-${index}`,
    userId: index % 3 === 0 ? 'user-me' : `user-${index}`,
    status: GameCartelaStatus.REGISTERED,
    isWinner: false,
    cartela: {
      id: `cartela-${index}`,
      number: index + 1,
    },
  }));
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

describe('operations/current payload diet', () => {
  it('keeps registeredCartelasSummary compact at 1000 cartelas', () => {
    const registrations = buildMockRegistrations(1000);
    const summary = buildRegisteredCartelasSummary(registrations, [], 'user-me');

    expect(summary).toHaveLength(1000);
    expect(summary[0]).toEqual({
      cartelaId: 'cartela-0',
      cartelaNumber: 1,
      owner: 'ME',
      status: GameCartelaStatus.REGISTERED,
    });
    expect(summary[0]).not.toHaveProperty('b');
    expect(summary[0]).not.toHaveProperty('markedCells');

    const oneSessionSummaryBytes = byteLength(summary);
    expect(oneSessionSummaryBytes).toBeLessThan(130_000);

    const legacyAllSessionsBytes = oneSessionSummaryBytes * 5;
    const phase2SessionsWithSummaryBytes = oneSessionSummaryBytes * 2;

    expect(phase2SessionsWithSummaryBytes).toBeLessThan(legacyAllSessionsBytes);
    expect(legacyAllSessionsBytes - phase2SessionsWithSummaryBytes).toBeGreaterThan(
      200_000,
    );
  });
});
