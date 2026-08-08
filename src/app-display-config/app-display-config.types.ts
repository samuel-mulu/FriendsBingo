export type AppDisplayConfigRecord = {
  id: string;
  showWinnerPhoneNumber: boolean;
  updatedAt: Date;
  updatedById: string | null;
};

export type AdminAppDisplayConfigResponse = {
  id: string;
  showWinnerPhoneNumber: boolean;
  updatedAt: string;
  updatedById: string | null;
};
