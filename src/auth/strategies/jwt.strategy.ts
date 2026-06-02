import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { UserStatus } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import {
  AuthenticatedUser,
  JwtPayload,
} from '../../common/types/jwt-payload.type';
import { PrismaService } from '../../prisma/prisma.service';
import { userProfileSelect } from '../../users/users.select';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: userProfileSelect,
    });

    if (!user) {
      throw new UnauthorizedException('Invalid access token');
    }

    if (user.status === UserStatus.BLOCKED) {
      throw new ForbiddenException('User account is blocked');
    }

    return user;
  }
}
