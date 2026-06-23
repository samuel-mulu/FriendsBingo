export const pushCategories = [
  'GAME_STARTED',
  'GAME_FINISHED',
  'WINNER_ANNOUNCEMENT',
  'DEPOSIT_APPROVED',
  'WITHDRAWAL_APPROVED',
  'WITHDRAWAL_REJECTED',
  'SYSTEM',
] as const;

export type PushCategory = (typeof pushCategories)[number];

export interface AppPushNotificationPayload {
  category: PushCategory;
  title: string;
  body: string;
  route?: string;
  entityId?: string;
  data?: Record<string, string>;
}
