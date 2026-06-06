import { UserRole } from '@prisma/client';
import { WsException } from '@nestjs/websockets';
import { RealtimeGateway } from './realtime.gateway';

describe('RealtimeGateway', () => {
  it('prevents a player from joining an unauthorized game room', async () => {
    const prisma = {
      gameCartela: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      game: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'game-1',
          status: 'CANCELLED',
        }),
      },
    };

    const gateway = new RealtimeGateway(
      { verifyAsync: jest.fn() } as never,
      { get: jest.fn().mockReturnValue('http://localhost:3000') } as never,
      prisma as never,
      { setServer: jest.fn() } as never,
    );

    const client = {
      data: {
        user: {
          userId: 'user-1',
          role: UserRole.PLAYER,
          phoneNumber: '0912345678',
        },
      },
      join: jest.fn(),
    };

    await expect(
      gateway.handleGameJoin(client as never, {
        gameId: '97bd6d2b-d547-4d72-9526-7b1b96d6425b',
      }),
    ).rejects.toBeInstanceOf(WsException);
  });
});
