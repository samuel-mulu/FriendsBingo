export interface AppPushBroadcastSummary {
  category: string;
  entityId: string;
  requestedUsers: number;
  eligibleUsers: number;
  reservedUsers: number;
  duplicateUsersSkipped: number;
  rateLimitedOrFilteredUsers: number;
  usersWithDevices: number;
  usersWithoutDevices: number;
  deviceCount: number;
  deviceSendsSucceeded: number;
  deviceSendsFailed: number;
  invalidTokensDisabled: number;
  failureCodes: Record<string, number>;
  reservationDurationMs: number;
  deviceLookupDurationMs: number;
  firebaseDurationMs: number;
  totalDurationMs: number;
  configuredConcurrency: number;
  /**
   * Legacy aliases kept for internal callers that still expect the old
   * summary shape. `sentCount` and `failedCount` refer to device attempts.
   */
  userCount: number;
  sentCount: number;
  failedCount: number;
}
