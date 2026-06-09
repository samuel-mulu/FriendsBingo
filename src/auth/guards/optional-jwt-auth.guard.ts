import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Authenticates when a Bearer token is present, but allows anonymous access.
 * Invalid or expired tokens are rejected (same as JwtAuthGuard).
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
    }>();
    const authorization = request.headers.authorization;

    if (!authorization?.startsWith('Bearer ')) {
      return true;
    }

    try {
      return (await super.canActivate(context)) as boolean;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      return true;
    }
  }

  handleRequest<TUser>(err: Error | null, user: TUser): TUser | null {
    if (err) {
      throw err;
    }

    return user ?? null;
  }
}
