import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  RegistrationCashbackTier,
  ResolvedRegistrationCashbackTier,
} from './registration-cashback.types';

export function parseTiersFromJson(raw: unknown): RegistrationCashbackTier[] {
  if (!Array.isArray(raw)) {
    throw new BadRequestException('tiers must be an array');
  }

  const tiers: RegistrationCashbackTier[] = raw.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new BadRequestException(`tiers[${index}] must be an object`);
    }
    const record = item as Record<string, unknown>;
    const minCartelasInSession = Number(record.minCartelasInSession);
    if (
      !Number.isInteger(minCartelasInSession) ||
      minCartelasInSession < 1
    ) {
      throw new BadRequestException(
        `tiers[${index}].minCartelasInSession must be a positive integer`,
      );
    }
    const rewardRaw = record.rewardEtb;
    const rewardEtb =
      typeof rewardRaw === 'number'
        ? rewardRaw.toString()
        : typeof rewardRaw === 'string'
          ? rewardRaw.trim()
          : '';
    if (!rewardEtb || Number(rewardEtb) <= 0) {
      throw new BadRequestException(
        `tiers[${index}].rewardEtb must be greater than zero`,
      );
    }
    return { minCartelasInSession, rewardEtb };
  });

  validateTierOrdering(tiers);
  return tiers;
}

export function validateTierOrdering(tiers: RegistrationCashbackTier[]): void {
  const seenMins = new Set<number>();
  let previousMin = 0;
  for (const tier of tiers) {
    if (seenMins.has(tier.minCartelasInSession)) {
      throw new BadRequestException(
        'tiers must have unique minCartelasInSession values',
      );
    }
    seenMins.add(tier.minCartelasInSession);
    if (tier.minCartelasInSession <= previousMin) {
      throw new BadRequestException(
        'tiers must be sorted by increasing minCartelasInSession',
      );
    }
    previousMin = tier.minCartelasInSession;
  }
}

export function resolveRegistrationCashbackTier(
  sessionCount: number,
  tiers: RegistrationCashbackTier[],
): ResolvedRegistrationCashbackTier | null {
  if (sessionCount <= 0 || tiers.length === 0) {
    return null;
  }

  let resolved: ResolvedRegistrationCashbackTier | null = null;
  for (const tier of tiers) {
    if (sessionCount >= tier.minCartelasInSession) {
      resolved = {
        minCartelasInSession: tier.minCartelasInSession,
        rewardEtb: tier.rewardEtb,
      };
    }
  }
  return resolved;
}

export function tiersToJson(
  tiers: RegistrationCashbackTier[],
): Prisma.InputJsonValue {
  return tiers.map((tier) => ({
    minCartelasInSession: tier.minCartelasInSession,
    rewardEtb: tier.rewardEtb,
  }));
}
