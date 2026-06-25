export const pushCategories = [
  'GAME_STARTED',
  'BONUS_GAME_STARTED',
  'GAME_FINISHED',
  'WINNER_ANNOUNCEMENT',
  'REGISTRATION_OPEN',
  'BIG_GAME_REGISTRATION_OPEN',
  'WINNER_WINDOW_STARTED',
  'BIG_GAME_TOMORROW',
  'BIG_GAME_TODAY',
  'DEPOSIT_APPROVED',
  'WITHDRAWAL_APPROVED',
  'WITHDRAWAL_COMPLETED',
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
