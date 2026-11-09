export type AppVersionConfigRecord = {
  id: string;
  releaseNotes: string;
  updatedAt: Date;
  updatedById: string | null;
};

export type AdminAppVersionConfigResponse = {
  id: string;
  releaseNotes: string;
  updatedAt: string;
  updatedById: string | null;
};
