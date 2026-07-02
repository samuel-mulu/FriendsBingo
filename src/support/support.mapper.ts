import {
  AdminPlayerSupportMessageRecord,
  PlayerSupportMessageRecord,
} from './support.select';

export function serializeSupportMessage(message: PlayerSupportMessageRecord) {
  return message;
}

export function serializeAdminSupportMessage(
  message: AdminPlayerSupportMessageRecord,
) {
  return {
    ...message,
    user: message.user,
  };
}
