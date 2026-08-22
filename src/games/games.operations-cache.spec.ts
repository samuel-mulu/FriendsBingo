import { stampWinnerPayoutOwners } from './games.mapper';
import { OperationsCacheService } from './operations-cache.service';

describe('games operations cache integration', () => {
  describe('stampWinnerPayoutOwners', () => {
    const neutralSummary = [
      {
        cartelaId: 'cartela-a',
        cartelaNumber: 12,
        amount: '50.00',
      },
      {
        cartelaId: 'cartela-b',
        cartelaNumber: 34,
        amount: '50.00',
      },
    ];

    const ownershipByCartelaId = {
      'cartela-a': 'admin-a',
      'cartela-b': 'admin-b',
    };

    it('marks admin A cartela as ME and others as OTHER', () => {
      const result = stampWinnerPayoutOwners(
        neutralSummary,
        'admin-a',
        ownershipByCartelaId,
      );

      expect(result).toEqual([
        {
          cartelaId: 'cartela-a',
          cartelaNumber: 12,
          amount: '50.00',
          owner: 'ME',
        },
        {
          cartelaId: 'cartela-b',
          cartelaNumber: 34,
          amount: '50.00',
          owner: 'OTHER',
        },
      ]);
    });

    it('marks admin B cartela as ME without reusing admin A ownership', () => {
      const result = stampWinnerPayoutOwners(
        neutralSummary,
        'admin-b',
        ownershipByCartelaId,
      );

      expect(result).toEqual([
        {
          cartelaId: 'cartela-a',
          cartelaNumber: 12,
          amount: '50.00',
          owner: 'OTHER',
        },
        {
          cartelaId: 'cartela-b',
          cartelaNumber: 34,
          amount: '50.00',
          owner: 'ME',
        },
      ]);
    });

    it('does not expose internal user IDs in the payout summary', () => {
      const result = stampWinnerPayoutOwners(
        neutralSummary,
        'admin-a',
        ownershipByCartelaId,
      );

      for (const entry of result ?? []) {
        expect(entry).not.toHaveProperty('userId');
        expect(JSON.stringify(entry)).not.toContain('admin-a');
        expect(JSON.stringify(entry)).not.toContain('admin-b');
      }
    });

    it('returns neutral summary without owner for player-safe overlay', () => {
      const result = stampWinnerPayoutOwners(
        neutralSummary,
        undefined,
        ownershipByCartelaId,
      );

      expect(result).toEqual(neutralSummary);
      expect(result?.every((entry) => entry.owner == null)).toBe(true);
    });
  });

  describe('shared player cache semantics', () => {
    let cache: OperationsCacheService;

    beforeEach(() => {
      cache = new OperationsCacheService();
    });

    it('shares guest and authenticated player snapshots via player cache key', () => {
      const generation = cache.getGeneration();
      const sharedSnapshot = {
        operationsState: 'active',
        registrationOpenGame: { sessionId: 'ready-1' },
      };

      cache.write('player', sharedSnapshot, generation);

      expect(cache.read('player')).toEqual(sharedSnapshot);
      expect(cache.read('player')).toEqual(sharedSnapshot);
      expect(cache.read('admin')).toBeNull();
    });

    it('never stores admin ownership in shared admin cache payload', () => {
      const generation = cache.getGeneration();
      const adminSharedSnapshot = {
        liveGame: {
          sessionId: 'live-1',
          winnerPayoutsSummary: [
            {
              cartelaId: 'cartela-a',
              cartelaNumber: 12,
              amount: '100.00',
            },
          ],
        },
        __winnerOwnershipByCartelaId: {
          'cartela-a': 'admin-a',
        },
      };

      cache.write('admin', adminSharedSnapshot, generation);
      const cached = cache.read<typeof adminSharedSnapshot>('admin');

      expect(cached?.liveGame?.winnerPayoutsSummary?.[0]?.owner).toBeUndefined();
      expect(cached?.__winnerOwnershipByCartelaId).toEqual({
        'cartela-a': 'admin-a',
      });
    });

    it('player payload path contains no admin ownership metadata when overlaid for player', () => {
      const playerVisibleSnapshot = {
        liveGame: {
          sessionId: 'live-1',
          playerStatus: 'winnerWindow',
        },
        operationsState: 'active',
      };

      expect(playerVisibleSnapshot.liveGame).not.toHaveProperty(
        'winnerPayoutsSummary',
      );
      expect(playerVisibleSnapshot).not.toHaveProperty(
        '__winnerOwnershipByCartelaId',
      );
    });
  });
});
