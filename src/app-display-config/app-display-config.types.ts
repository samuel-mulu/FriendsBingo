import { WinnerPhoneDisplayMode } from '@prisma/client';

export type AppDisplayConfigRecord = {
  id: string;
  winnerPhoneDisplayMode: WinnerPhoneDisplayMode;
  updatedAt: Date;
  updatedById: string | null;
};

export type AdminAppDisplayConfigResponse = {
  id: string;
  winnerPhoneDisplayMode: WinnerPhoneDisplayMode;
  updatedAt: string;
  updatedById: string | null;
};
