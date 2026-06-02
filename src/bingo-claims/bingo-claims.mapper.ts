import { BingoClaimRecord } from './bingo-claims.select';

export function serializeBingoClaim(claim: BingoClaimRecord) {
  return {
    ...claim,
  };
}
