import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthAccount } from './entities/auth-account.entity';
import { AuthSession } from './entities/auth-session.entity';
import { OAuthLoginAttempt } from './entities/oauth-login-attempt.entity';
import { OAuthRateLimitGuard } from './guards/oauth-rate-limit.guard';
import { OriginGuard } from './guards/origin.guard';
import { SessionAuthGuard } from './guards/session-auth.guard';
import { FacebookAuthProvider } from './providers/facebook-auth.provider';
import { GoogleAuthProvider } from './providers/google-auth.provider';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      AuthAccount,
      AuthSession,
      OAuthLoginAttempt,
    ]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    GoogleAuthProvider,
    FacebookAuthProvider,
    SessionAuthGuard,
    OriginGuard,
    OAuthRateLimitGuard,
  ],
  exports: [AuthService, SessionAuthGuard],
})
export class AuthModule {}
