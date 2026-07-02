import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CartelasService } from './cartelas.service';

describe('CartelasService', () => {
  const cartelaRecord = {
    id: 'cartela-1',
    number: 7,
    b: ['1', '2', '3', '4', '5'],
    i: ['16', '17', '18', '19', '20'],
    n: ['31', '32', 'FREE', '34', '35'],
    g: ['46', '47', '48', '49', '50'],
    o: ['61', '62', '63', '64', '65'],
    createdAt: new Date('2026-06-01T10:00:00.000Z'),
  };

  it('returns catalog entries with number metadata only', async () => {
    const prisma = {
      cartela: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'cartela-1',
            number: 7,
            createdAt: cartelaRecord.createdAt,
          },
        ]),
      },
    };

    const service = new CartelasService(prisma as never);
    const result = await service.getCartelaCatalog();

    expect(prisma.cartela.findMany).toHaveBeenCalledWith({
      orderBy: [{ number: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        number: true,
        createdAt: true,
      },
    });
    expect(result).toEqual([
      {
        id: 'cartela-1',
        number: 7,
        createdAt: cartelaRecord.createdAt,
      },
    ]);
  });

  it('returns a paged catalog when query params are provided', async () => {
    const prisma = {
      cartela: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: 'cartela-1',
            number: 7,
            createdAt: cartelaRecord.createdAt,
          },
          {
            id: 'cartela-2',
            number: 70,
            createdAt: cartelaRecord.createdAt,
          },
        ])
        .mockResolvedValueOnce([{ count: 2n }]),
    };

    const service = new CartelasService(prisma as never);
    const result = await service.getCartelaCatalog({
      limit: 1,
      search: '7',
    });

    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        items: [
          {
            id: 'cartela-1',
            number: 7,
            createdAt: cartelaRecord.createdAt,
          },
        ],
        total: 2,
        nextCursor: expect.any(String),
      }),
    );
  });

  it('returns a random shuffled page from the full catalog', async () => {
    const prisma = {
      cartela: {
        findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(10000),
      },
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: 'cartela-9',
          number: 999,
          createdAt: cartelaRecord.createdAt,
        },
      ]),
    };

    const service = new CartelasService(prisma as never);
    const result = await service.getCartelaCatalog({
      limit: 1,
      shuffle: true,
    });

    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        items: [
          {
            id: 'cartela-9',
            number: 999,
            createdAt: cartelaRecord.createdAt,
          },
        ],
        nextCursor: null,
        total: 10000,
      }),
    );
  });

  it('rejects invalid cursors for paged catalog requests', async () => {
    const prisma = {
      cartela: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };

    const service = new CartelasService(prisma as never);

    await expect(
      service.getCartelaCatalog({
        limit: 10,
        cursor: 'not-a-cursor',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows a player to fetch a board for an active reservation', async () => {
    const prisma = {
      cartela: {
        findUnique: jest.fn().mockResolvedValue(cartelaRecord),
      },
      gameCartela: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      gameCartelaReservation: {
        findFirst: jest.fn().mockResolvedValue({ id: 'reservation-1' }),
      },
    };

    const service = new CartelasService(prisma as never);
    const result = await service.getCartelaBoard(
      'cartela-1',
      'user-1',
      UserRole.PLAYER,
      'session-1',
    );

    expect(result.b).toEqual(cartelaRecord.b);
    expect(result.number).toBe(7);
  });

  it('rejects board access for unrelated players', async () => {
    const prisma = {
      cartela: {
        findUnique: jest.fn().mockResolvedValue(cartelaRecord),
      },
      gameCartela: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      gameCartelaReservation: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    const service = new CartelasService(prisma as never);

    await expect(
      service.getCartelaBoard(
        'cartela-1',
        'user-1',
        UserRole.PLAYER,
        'session-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows admins to fetch any board', async () => {
    const prisma = {
      cartela: {
        findUnique: jest.fn().mockResolvedValue(cartelaRecord),
      },
    };

    const service = new CartelasService(prisma as never);
    const result = await service.getCartelaBoard(
      'cartela-1',
      'admin-1',
      UserRole.ADMIN,
      'session-1',
    );

    expect(result.g).toEqual(cartelaRecord.g);
  });

  it('throws when cartela does not exist', async () => {
    const prisma = {
      cartela: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };

    const service = new CartelasService(prisma as never);

    await expect(
      service.getCartelaBoard(
        'missing',
        'user-1',
        UserRole.PLAYER,
        'session-1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
