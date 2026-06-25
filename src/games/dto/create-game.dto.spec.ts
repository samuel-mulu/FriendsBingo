import { plainToInstance } from 'class-transformer';
import { GameCategory } from '@prisma/client';
import { validate } from 'class-validator';
import { CreateGameDto } from './create-game.dto';

describe('CreateGameDto', () => {
  it('accepts valid Big Game foundation fields', async () => {
    const dto = plainToInstance(CreateGameDto, {
      gameRuleId: '6b7130c0-0f7d-4c42-9a31-d8e9a3920b95',
      category: GameCategory.BIG_GAME,
      fixedPrizeAmount: '5000',
      entryFee: '25',
      maxCartelasPerPlayer: 20,
      registrationOpensAt: '2026-07-01T09:00:00.000Z',
      playStartAt: '2026-07-01T12:00:00.000Z',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('rejects invalid Big Game datetime fields', async () => {
    const dto = plainToInstance(CreateGameDto, {
      gameRuleId: '6b7130c0-0f7d-4c42-9a31-d8e9a3920b95',
      category: GameCategory.BIG_GAME,
      registrationOpensAt: 'not-a-date',
      playStartAt: '2026-07-01T12:00:00.000Z',
    });

    const errors = await validate(dto);
    const properties = errors.map((error) => error.property);

    expect(properties).toContain('registrationOpensAt');
  });
});
