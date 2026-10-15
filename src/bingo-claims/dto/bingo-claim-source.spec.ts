import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BingoClaimSource, resolveBingoClaimSource } from './bingo-claim-source';
import { CreateBingoClaimDto } from './create-bingo-claim.dto';

describe('BingoClaimSource / CreateBingoClaimDto', () => {
  it('resolveBingoClaimSource defaults missing to MANUAL', () => {
    expect(resolveBingoClaimSource(undefined)).toBe(BingoClaimSource.MANUAL);
    expect(resolveBingoClaimSource(null)).toBe(BingoClaimSource.MANUAL);
    expect(resolveBingoClaimSource('')).toBe(BingoClaimSource.MANUAL);
  });

  it('resolveBingoClaimSource preserves AUTO and MANUAL', () => {
    expect(resolveBingoClaimSource(BingoClaimSource.AUTO)).toBe(
      BingoClaimSource.AUTO,
    );
    expect(resolveBingoClaimSource(BingoClaimSource.MANUAL)).toBe(
      BingoClaimSource.MANUAL,
    );
  });

  it('DTO accepts missing claimSource', async () => {
    const dto = plainToInstance(CreateBingoClaimDto, {
      gameCartelaId: '9bbeb535-bf01-4d6e-823c-e6d5556430d4',
      claimAttemptId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.claimSource).toBeUndefined();
  });

  it('DTO accepts AUTO and MANUAL', async () => {
    for (const claimSource of [BingoClaimSource.AUTO, BingoClaimSource.MANUAL]) {
      const dto = plainToInstance(CreateBingoClaimDto, {
        gameCartelaId: '9bbeb535-bf01-4d6e-823c-e6d5556430d4',
        claimAttemptId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        claimSource,
      });
      expect(await validate(dto)).toHaveLength(0);
    }
  });

  it('DTO rejects unknown claimSource', async () => {
    const dto = plainToInstance(CreateBingoClaimDto, {
      gameCartelaId: '9bbeb535-bf01-4d6e-823c-e6d5556430d4',
      claimAttemptId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      claimSource: 'ROBOT',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'claimSource')).toBe(true);
  });
});
