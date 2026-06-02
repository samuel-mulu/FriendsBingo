import { UserRole } from '@prisma/client';

export interface RealtimeUser {
  userId: string;
  role: UserRole;
  phoneNumber: string;
}
