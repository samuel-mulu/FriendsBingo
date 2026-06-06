import { ConflictException } from '@nestjs/common';
import { GameStatus } from '@prisma/client';
import { CalledNumbersService } from './called-numbers.service';

describe('CalledNumbersService', () => {
  it('rejects duplicate called numbers in the same session', async () => {
    const tx = {
      gameSession: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'session-1',
          status: GameStatus.PLAYING,
        }),
      },
      calledNumber: {
        findFirst: jest.fn().mockResolvedValue({ id: 'called-1' }),
      },
    };

    const prisma = {
      $transaction: jest.fn(async (callback: (db: typeof tx) => unknown) =>
        callback(tx),
      ),
    };

    const service = new CalledNumbersService(
      prisma as never,
      {
        emitToGame: jest.fn(),
        emitToAdmin: jest.fn(),
        emitToUser: jest.fn(),
      } as never,
      {
        create: jest.fn().mockResolvedValue(undefined),
      } as never,
    );

    await expect(
      service.callNumber('session-1', { letter: 'B', number: 15 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
