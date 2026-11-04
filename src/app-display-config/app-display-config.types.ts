import { WinnerPhoneDisplayMode } from '@prisma/client';

export type AppDisplayConfigRecord = {
  id: string;
  winnerPhoneDisplayMode: WinnerPhoneDisplayMode;
  bigGamePromotionCardEnabled: boolean;
  bingoClaimLastSecondLockEnabled: boolean;
  updatedAt: Date;
  updatedById: string | null;
};

export type AdminAppDisplayConfigResponse = {
  id: string;
  winnerPhoneDisplayMode: WinnerPhoneDisplayMode;
  bigGamePromotionCardEnabled: boolean;
  bingoClaimLastSecondLockEnabled: boolean;
  updatedAt: string;
  updatedById: string | null;
};

export type PlayerAppDisplayConfigResponse = {
  bigGamePromotionCardEnabled: boolean;
  bingoClaimLastSecondLockEnabled: boolean;
};
