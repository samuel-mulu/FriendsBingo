import { UserRole } from '@prisma/client';
import { WsException } from '@nestjs/websockets';
import { RealtimeGateway } from './realtime.gateway';

describe('RealtimeGateway', () => {
  it('prevents a player from joining an unauthorized game room', async () => {
    const prisma = {
      gameCartela: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      gameSession: {
        findUnique: jest.fn().mockResolvedValue({
          id: '97bd6d2b-d547-4d72-9526-7b1b96d6425b',
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
        sessionId: '97bd6d2b-d547-4d72-9526-7b1b96d6425b',
      }),
    ).rejects.toBeInstanceOf(WsException);
  });

  it('moves player sockets out of the public room while joined to a live session', async () => {
    const prisma = {
      gameCartela: {
        findFirst: jest.fn().mockResolvedValue({ id: 'gc-1' }),
      },
      gameSession: {
        findUnique: jest.fn().mockResolvedValue({
          id: '97bd6d2b-d547-4d72-9526-7b1b96d6425b',
          status: 'PLAYING',
        }),
      },
    };

    const realtimeService = {
      setServer: jest.fn(),
      getPublicGamesRoom: jest.fn().mockReturnValue('games:public'),
      getSessionRoom: jest
        .fn()
        .mockImplementation((sessionId: string) => `session:${sessionId}`),
    };

    const gateway = new RealtimeGateway(
      { verifyAsync: jest.fn() } as never,
      { get: jest.fn().mockReturnValue('http://localhost:3000') } as never,
      prisma as never,
      realtimeService as never,
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
      leave: jest.fn(),
    };

    await gateway.handleGameJoin(client as never, {
      sessionId: '97bd6d2b-d547-4d72-9526-7b1b96d6425b',
    });

    expect(client.leave).toHaveBeenCalledWith('games:public');
    expect(client.join).toHaveBeenCalledWith(
      'session:97bd6d2b-d547-4d72-9526-7b1b96d6425b',
    );

    await gateway.handleGameLeave(client as never, {
      sessionId: '97bd6d2b-d547-4d72-9526-7b1b96d6425b',
    });

    expect(client.leave).toHaveBeenCalledWith(
      'session:97bd6d2b-d547-4d72-9526-7b1b96d6425b',
    );
    expect(client.join).toHaveBeenCalledWith('games:public');
  });
});
