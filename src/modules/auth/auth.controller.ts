import {
  Controller,
  Body,
  Get,
  Headers,
  Logger,
  Post,
  Patch,
  Query,
  Redirect,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { User } from '../users/entities/user.entity';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthProvider } from './entities/auth-account.entity';
import { OAuthRateLimitGuard } from './guards/oauth-rate-limit.guard';
import { OriginGuard } from './guards/origin.guard';
import { SessionAuthGuard } from './guards/session-auth.guard';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly auth: AuthService) {}

  @Get('google')
  @UseGuards(OAuthRateLimitGuard)
  @Redirect()
  async google(@Query('returnPath') returnPath?: string) {
    const result = await this.auth.startLogin(AuthProvider.GOOGLE, returnPath);
    return { url: result.authorizationUrl, statusCode: 302 };
  }

  @Get('facebook')
  @UseGuards(OAuthRateLimitGuard)
  @Redirect()
  async facebook(@Query('returnPath') returnPath?: string) {
    const result = await this.auth.startLogin(
      AuthProvider.FACEBOOK,
      returnPath,
    );
    return { url: result.authorizationUrl, statusCode: 302 };
  }

  @Get('google/url')
  @UseGuards(OAuthRateLimitGuard)
  async googleUrl(@Query('returnPath') returnPath?: string) {
    return this.auth.startLogin(AuthProvider.GOOGLE, returnPath);
  }

  @Get('facebook/url')
  @UseGuards(OAuthRateLimitGuard)
  async facebookUrl(@Query('returnPath') returnPath?: string) {
    return this.auth.startLogin(AuthProvider.FACEBOOK, returnPath);
  }

  @Get('google/callback')
  @UseGuards(OAuthRateLimitGuard)
  async googleCallback(
    @Query('state') state: string,
    @Query('code') code: string,
    @Query('error') error: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    await this.completeCallback(
      AuthProvider.GOOGLE,
      state,
      code,
      error,
      userAgent,
      response,
    );
  }

  @Get('facebook/callback')
  @UseGuards(OAuthRateLimitGuard)
  async facebookCallback(
    @Query('state') state: string,
    @Query('code') code: string,
    @Query('error') error: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    await this.completeCallback(
      AuthProvider.FACEBOOK,
      state,
      code,
      error,
      userAgent,
      response,
    );
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  me(@CurrentUser() user: User) {
    return this.auth.getCurrentUser(user.id);
  }

  @Patch('profile')
  @UseGuards(OriginGuard, SessionAuthGuard)
  updateProfile(@CurrentUser() user: User, @Body() body: { fullName?: string; phoneNumber?: string; addressLine?: string; city?: string; province?: string; postalCode?: string; country?: string }) {
    return this.auth.updateProfile(user.id, body);
  }

  @Post('logout')
  @UseGuards(OriginGuard)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.revokeSession(
      this.readCookie(request, this.auth.cookieName),
    );
    this.clearCookie(response);
    return { success: true };
  }

  @Post('register')
  @UseGuards(OriginGuard)
  async register(
    @Body() body: { name?: string; email?: string; password?: string },
  ) {
    return this.auth.register(body.name, body.email, body.password);
  }

  @Post('verify-email')
  @UseGuards(OriginGuard)
  async verifyEmail(
    @Body() body: { email?: string; code?: string },
    @Headers('user-agent') userAgent: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.verifyEmail(
      body.email,
      body.code,
      userAgent,
    );
    response.cookie(this.auth.cookieName, result.token, {
      httpOnly: true,
      secure: this.auth.cookieSecure,
      sameSite: this.auth.cookieSameSite,
      path: '/',
      maxAge: this.auth.cookieMaxAgeMs,
    });
    return { user: await this.auth.getCurrentUser(result.userId) };
  }

  @Post('resend-verification')
  @UseGuards(OriginGuard)
  async resendVerification(@Body() body: { email?: string }) {
    return this.auth.resendVerification(body.email);
  }

  @Post('login')
  @UseGuards(OriginGuard)
  async emailLogin(
    @Body() body: { email?: string; password?: string },
    @Headers('user-agent') userAgent: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.emailLogin(
      body.email,
      body.password,
      userAgent,
    );
    response.cookie(this.auth.cookieName, result.token, {
      httpOnly: true,
      secure: this.auth.cookieSecure,
      sameSite: this.auth.cookieSameSite,
      path: '/',
      maxAge: this.auth.cookieMaxAgeMs,
    });
    return this.auth.getCurrentUser(result.userId);
  }

  @Post('password-reset/request')
  @UseGuards(OriginGuard)
  requestPasswordReset(@Body() body: { email?: string }) {
    return this.auth.requestPasswordReset(body.email);
  }

  @Post('password-reset/verify')
  @UseGuards(OriginGuard)
  verifyPasswordReset(@Body() body: { email?: string; code?: string }) {
    return this.auth.verifyPasswordResetOtp(body.email, body.code);
  }

  @Post('password-reset/complete')
  @UseGuards(OriginGuard)
  resetPassword(@Body() body: { resetToken?: string; password?: string }) {
    return this.auth.resetPassword(body.resetToken, body.password);
  }

  @Post('password-change/request')
  @UseGuards(OriginGuard, SessionAuthGuard)
  requestPasswordChange(@CurrentUser() user: User) {
    return this.auth.requestPasswordChange(user.id);
  }

  @Post('password-change/verify')
  @UseGuards(OriginGuard, SessionAuthGuard)
  verifyPasswordChange(@CurrentUser() user: User, @Body() body: { code?: string }) {
    return this.auth.verifyPasswordChangeOtp(user.id, body.code);
  }

  @Post('password-change/complete')
  @UseGuards(OriginGuard, SessionAuthGuard)
  changePassword(@CurrentUser() user: User, @Body() body: { resetToken?: string; password?: string }) {
    return this.auth.changePassword(user.id, body.resetToken, body.password);
  }

  @Post('logout-all')
  @UseGuards(OriginGuard, SessionAuthGuard)
  async logoutAll(
    @CurrentUser() user: User,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.revokeAllSessions(user.id);
    this.clearCookie(response);
    return { success: true };
  }

  private async completeCallback(
    provider: AuthProvider,
    state: string,
    code: string,
    providerError: string | undefined,
    userAgent: string | undefined,
    response: Response,
  ): Promise<void> {
    if (providerError) {
      response.redirect(302, `${this.auth.frontendUrl}/?authError=cancelled`);
      return;
    }
    try {
      const result = await this.auth.completeLogin(
        provider,
        state,
        code,
        userAgent,
      );
      response.cookie(this.auth.cookieName, result.token, {
        httpOnly: true,
        secure: this.auth.cookieSecure,
        sameSite: this.auth.cookieSameSite,
        path: '/',
        maxAge: this.auth.cookieMaxAgeMs,
      });
      response.redirect(302, `${this.auth.frontendUrl}${result.returnPath}`);
    } catch (error) {
      this.logger.warn(
        `${provider} OAuth callback failed (${error instanceof Error ? error.name : 'unknown error'}).`,
      );
      response.redirect(302, `${this.auth.frontendUrl}/?authError=failed`);
    }
  }

  private clearCookie(response: Response): void {
    response.clearCookie(this.auth.cookieName, {
      httpOnly: true,
      secure: this.auth.cookieSecure,
      sameSite: this.auth.cookieSameSite,
      path: '/',
    });
  }

  private readCookie(request: Request, name: string): string | undefined {
    for (const item of (request.headers.cookie || '').split(';')) {
      const separator = item.indexOf('=');
      if (separator >= 0 && item.slice(0, separator).trim() === name) {
        return decodeURIComponent(item.slice(separator + 1).trim());
      }
    }
    return undefined;
  }
}
