import { resolveForceBigGameTicketsPerWinner } from './force-big-game-tickets.util';

describe('resolveForceBigGameTicketsPerWinner', () => {
  it('gives the full pool to a single winner', () => {
    expect(resolveForceBigGameTicketsPerWinner(4, 1)).toBe(4);
    expect(resolveForceBigGameTicketsPerWinner(2, 1)).toBe(2);
  });

  it('splits the pool evenly for two winners', () => {
    expect(resolveForceBigGameTicketsPerWinner(4, 2)).toBe(2);
    expect(resolveForceBigGameTicketsPerWinner(2, 2)).toBe(1);
    expect(resolveForceBigGameTicketsPerWinner(8, 2)).toBe(4);
  });

  it('grants nothing when there are three or more winners', () => {
    expect(resolveForceBigGameTicketsPerWinner(4, 3)).toBe(0);
    expect(resolveForceBigGameTicketsPerWinner(4, 5)).toBe(0);
  });

  it('returns zero for invalid pool or winner counts', () => {
    expect(resolveForceBigGameTicketsPerWinner(0, 1)).toBe(0);
    expect(resolveForceBigGameTicketsPerWinner(-2, 1)).toBe(0);
    expect(resolveForceBigGameTicketsPerWinner(4, 0)).toBe(0);
  });
});
