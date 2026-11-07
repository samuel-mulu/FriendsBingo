export type AppSupportConfigRecord = {
  id: string;
  phoneNumber1: string;
  phoneNumber2: string;
  telegramUsername: string;
  termsBody: string;
  updatedAt: Date;
  updatedById: string | null;
};

export type AdminAppSupportConfigResponse = {
  id: string;
  phoneNumber1: string;
  phoneNumber2: string;
  telegramUsername: string;
  termsBody: string;
  updatedAt: string;
  updatedById: string | null;
};

export type PlayerAppSupportConfigResponse = {
  phoneNumber1: string;
  phoneNumber2: string;
  telegramUsername: string;
  termsBody: string;
};
