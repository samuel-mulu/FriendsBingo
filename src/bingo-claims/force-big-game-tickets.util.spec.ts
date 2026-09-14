import {
  isValidForceBigGameCartelaCount,
  resolveForceBigGameTicketsPerWinner,
} from './force-big-game-tickets.util';

describe('isValidForceBigGameCartelaCount', () => {
  it('allows 1 and even pools from 2 to 10', () => {
    expect([1, 2, 4, 6, 8, 10].every(isValidForceBigGameCartelaCount)).toBe(
      true,
    );
  });

  it('rejects odd pools other than 1 and out-of-range values', () => {
    expect(isValidForceBigGameCartelaCount(3)).toBe(false);
    expect(isValidForceBigGameCartelaCount(5)).toBe(false);
    expect(isValidForceBigGameCartelaCount(0)).toBe(false);
    expect(isValidForceBigGameCartelaCount(12)).toBe(false);
  });
});

describe('resolveForceBigGameTicketsPerWinner', () => {
  it('gives the full pool to a single winner', () => {
    expect(resolveForceBigGameTicketsPerWinner(1, 1)).toBe(1);
    expect(resolveForceBigGameTicketsPerWinner(4, 1)).toBe(4);
    expect(resolveForceBigGameTicketsPerWinner(2, 1)).toBe(2);
  });

  it('splits the pool evenly for two winners', () => {
    expect(resolveForceBigGameTicketsPerWinner(4, 2)).toBe(2);
    expect(resolveForceBigGameTicketsPerWinner(2, 2)).toBe(1);
    expect(resolveForceBigGameTicketsPerWinner(8, 2)).toBe(4);
  });

  it('grants 1 ticket to each of two winners when the pool is 1', () => {
    expect(resolveForceBigGameTicketsPerWinner(1, 2)).toBe(1);
  });

  it('grants nothing when there are three or more winners', () => {
    expect(resolveForceBigGameTicketsPerWinner(1, 3)).toBe(0);
    expect(resolveForceBigGameTicketsPerWinner(4, 3)).toBe(0);
    expect(resolveForceBigGameTicketsPerWinner(4, 5)).toBe(0);
  });

  it('returns zero for invalid pool or winner counts', () => {
    expect(resolveForceBigGameTicketsPerWinner(0, 1)).toBe(0);
    expect(resolveForceBigGameTicketsPerWinner(-2, 1)).toBe(0);
    expect(resolveForceBigGameTicketsPerWinner(4, 0)).toBe(0);
  });
});
