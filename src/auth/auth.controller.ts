import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RequestOtpDto } from './dto/request-otp.dto';
import { RequestPasswordResetOtpDto } from './dto/request-password-reset-otp.dto';
import { RequestRegisterOtpDto } from './dto/request-register-otp.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { AuthService } from './auth.service';

function resolveRequestIp(request: Request): string | undefined {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim();
  }

  return request.ip;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('request-otp')
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Request an OTP for login or registration' })
  requestOtp(@Body() requestOtpDto: RequestOtpDto, @Req() request: Request) {
    return this.authService.requestOtp(requestOtpDto, resolveRequestIp(request));
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Verify OTP and sign in' })
  verifyOtp(@Body() verifyOtpDto: VerifyOtpDto) {
    return this.authService.verifyOtp(verifyOtpDto);
  }

  @Post('request-register-otp')
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Request a registration OTP' })
  requestRegisterOtp(
    @Body() requestRegisterOtpDto: RequestRegisterOtpDto,
    @Req() request: Request,
  ) {
    return this.authService.requestRegisterOtp(
      requestRegisterOtpDto.phoneNumber,
      resolveRequestIp(request),
    );
  }

  @Post('register')
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Register a new player account' })
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Login with phone number and password' })
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('request-password-reset-otp')
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Request a password reset OTP' })
  requestPasswordResetOtp(
    @Body() requestPasswordResetOtpDto: RequestPasswordResetOtpDto,
    @Req() request: Request,
  ) {
    return this.authService.requestPasswordResetOtp(
      requestPasswordResetOtpDto.phoneNumber,
      resolveRequestIp(request),
    );
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Reset password with OTP' })
  resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Refresh access token using refresh token' })
  refresh(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.refreshTokens(
      refreshTokenDto.refreshToken,
      refreshTokenDto.deviceId,
    );
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Logout and revoke refresh token' })
  logout(@Body() logoutDto: LogoutDto) {
    return this.authService.logout(logoutDto.refreshToken, logoutDto.deviceId);
  }
}
