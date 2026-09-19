import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedUser } from '../common/types/jwt-payload.type';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RequestOtpDto } from './dto/request-otp.dto';
import { RequestPasswordResetOtpDto } from './dto/request-password-reset-otp.dto';
import { RequestRegisterOtpDto } from './dto/request-register-otp.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { LogoutOtherSessionsDto } from './dto/session.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import {
  TelegramCompleteDto,
  TelegramLinkDto,
  TelegramRequestOtpDto,
  TelegramStartDto,
} from './dto/telegram-auth.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

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
  @Throttle({ auth: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Request an OTP for login or registration' })
  requestOtp(@Body() requestOtpDto: RequestOtpDto, @Req() request: Request) {
    return this.authService.requestOtp(
      requestOtpDto,
      resolveRequestIp(request),
    );
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Verify OTP and sign in' })
  verifyOtp(@Body() verifyOtpDto: VerifyOtpDto) {
    return this.authService.verifyOtp(verifyOtpDto);
  }

  @Post('request-register-otp')
  @Throttle({ auth: { limit: 120, ttl: 60_000 } })
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
  @Throttle({ auth: { limit: 100, ttl: 60_000 } })
  @ApiOperation({ summary: 'Register a new player account' })
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 200, ttl: 60_000 } })
  @ApiOperation({ summary: 'Login with phone number and password' })
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('request-password-reset-otp')
  @Throttle({ auth: { limit: 120, ttl: 60_000 } })
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
  @Throttle({ auth: { limit: 100, ttl: 60_000 } })
  @ApiOperation({ summary: 'Reset password with OTP' })
  resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ auth: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Change password for the logged-in user' })
  changePassword(
    @Body() changePasswordDto: ChangePasswordDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.authService.changePassword(user.id, changePasswordDto);
  }

  @Post('request-set-password-otp')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ auth: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Request OTP to set a password on a password-less account',
  })
  requestSetPasswordOtp(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.authService.requestSetPasswordOtp(
      user.id,
      resolveRequestIp(request),
    );
  }

  @Post('set-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ auth: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Set password with OTP for password-less accounts' })
  setPassword(
    @Body() setPasswordDto: SetPasswordDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.authService.setPassword(user.id, setPasswordDto);
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List active sessions for the current user' })
  listSessions(
    @CurrentUser() user: AuthenticatedUser,
    @Query('refreshToken') refreshToken?: string,
    @Query('deviceId') deviceId?: string,
  ) {
    return this.authService.listSessions(user.id, { refreshToken, deviceId });
  }

  @Delete('sessions/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke one session by id' })
  revokeSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') sessionId: string,
  ) {
    return this.authService.revokeSession(user.id, sessionId);
  }

  @Post('sessions/logout-others')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout all other sessions' })
  logoutOtherSessions(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: LogoutOtherSessionsDto,
  ) {
    return this.authService.logoutOtherSessions(
      user.id,
      body.refreshToken,
      body.deviceId,
    );
  }

  @Post('telegram/start')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 100, ttl: 60_000 } })
  @ApiOperation({ summary: 'Start Telegram login / register' })
  telegramStart(@Body() dto: TelegramStartDto) {
    return this.authService.telegramStart(dto);
  }

  @Post('telegram/request-otp')
  @Throttle({ auth: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Request SMS OTP after Telegram verification' })
  telegramRequestOtp(
    @Body() dto: TelegramRequestOtpDto,
    @Req() request: Request,
  ) {
    return this.authService.telegramRequestOtp(dto, resolveRequestIp(request));
  }

  @Post('telegram/complete')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 100, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Complete Telegram auth: link existing phone or register new phone',
  })
  telegramComplete(@Body() dto: TelegramCompleteDto) {
    return this.authService.telegramComplete(dto);
  }

  @Post('telegram/link')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ auth: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Link Telegram to the current account' })
  linkTelegram(
    @Body() dto: TelegramLinkDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.authService.linkTelegram(user.id, dto);
  }

  @Post('telegram/unlink')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ auth: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Unlink Telegram from the current account' })
  unlinkTelegram(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.unlinkTelegram(user.id);
  }

  @Get('telegram/widget')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @ApiOperation({ summary: 'Telegram Login Widget HTML page' })
  telegramWidget(@Req() request: Request, @Res() res: Response) {
    const protoHeader = request.headers['x-forwarded-proto'];
    const proto =
      typeof protoHeader === 'string' && protoHeader.length > 0
        ? protoHeader.split(',')[0]?.trim()
        : request.protocol;
    const host = request.get('host');
    const callbackUrl = `${proto}://${host}/auth/telegram/callback`;
    const html = this.authService.getTelegramWidgetHtml(callbackUrl);
    res.send(html);
  }

  @Get('telegram/callback')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @ApiOperation({
    summary: 'Telegram Login Widget callback → app deep link handoff page',
  })
  telegramCallback(@Query() query: Record<string, string>, @Res() res: Response) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === 'string' && value.length > 0) {
        params.set(key, value);
      }
    }

    if (!params.has('id') || !params.has('auth_date') || !params.has('hash')) {
      res.status(400).send('Invalid Telegram callback.');
      return;
    }

    const html = this.authService.getTelegramCallbackHtml(params.toString());
    res.send(html);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 300, ttl: 60_000 } })
  @ApiOperation({ summary: 'Refresh access token using refresh token' })
  refresh(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.refreshTokens(
      refreshTokenDto.refreshToken,
      refreshTokenDto.deviceId,
      {
        platform: refreshTokenDto.platform,
        deviceLabel: refreshTokenDto.deviceLabel,
        userAgent: refreshTokenDto.userAgent,
      },
    );
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Logout and revoke refresh token' })
  logout(@Body() logoutDto: LogoutDto) {
    return this.authService.logout(logoutDto.refreshToken, logoutDto.deviceId);
  }
}
