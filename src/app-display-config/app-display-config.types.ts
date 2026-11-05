import { WinnerPhoneDisplayMode } from '@prisma/client';

export type AppDisplayConfigRecord = {
  id: string;
  winnerPhoneDisplayMode: WinnerPhoneDisplayMode;
  bigGamePromotionCardEnabled: boolean;
  updatedAt: Date;
  updatedById: string | null;
};

export type AdminAppDisplayConfigResponse = {
  id: string;
  winnerPhoneDisplayMode: WinnerPhoneDisplayMode;
  bigGamePromotionCardEnabled: boolean;
  updatedAt: string;
  updatedById: string | null;
};

export type PlayerAppDisplayConfigResponse = {
  bigGamePromotionCardEnabled: boolean;
};
