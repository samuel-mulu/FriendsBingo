export type RegistrationCashbackTier = {
  minCartelasInSession: number;
  rewardEtb: string;
};

export type ResolvedRegistrationCashbackTier = {
  minCartelasInSession: number;
  rewardEtb: string;
};

export type RegistrationCashbackSettlementPayload = {
  userId: string;
  amount: string;
  sessionQualifyingCount: number;
  lifetimeQualifyingCount: number;
  tierMinCartelas: number;
  gameSessionId: string;
};
