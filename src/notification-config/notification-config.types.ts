export type NotificationConfigRecord = {
  id: string;
  pushNotificationsEnabled: boolean;
  updatedAt: Date;
  updatedById: string | null;
};

export type AdminNotificationConfigResponse = {
  id: string;
  pushNotificationsEnabled: boolean;
  updatedAt: string;
  updatedById: string | null;
};
