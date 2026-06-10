import { ForbiddenException, NotFoundException } from '@nestjs/common';
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

  it('returns number-only catalog entries', async () => {
    const prisma = {
      cartela: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: cartelaRecord.id,
            number: cartelaRecord.number,
            createdAt: cartelaRecord.createdAt,
          },
        ]),
      },
    };

    const service = new CartelasService(prisma as never);
    const result = await service.getCartelaCatalog();

    expect(result).toEqual([
      {
        id: 'cartela-1',
        number: 7,
        createdAt: cartelaRecord.createdAt,
      },
    ]);
    expect(result[0]).not.toHaveProperty('b');
    expect(result[0]).not.toHaveProperty('i');
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
