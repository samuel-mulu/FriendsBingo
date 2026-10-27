export type DepositManualApprovalPinConfigRecord = {
  id: string;
  pinHash: string;
  updatedAt: Date;
  updatedById: string | null;
};

export type AdminDepositManualApprovalPinConfigResponse = {
  id: string;
  updatedAt: string;
  updatedById: string | null;
  /** True when the PIN hash is stored in the database (not the in-memory fallback). */
  storedInDatabase: boolean;
};
