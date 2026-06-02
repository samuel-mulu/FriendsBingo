import { UserRole, UserStatus } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  phoneNumber: string;
  role: UserRole;
}

export interface AuthenticatedUser {
  id: string;
  fullName: string;
  phoneNumber: string;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}
