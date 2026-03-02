import { Module } from '@nestjs/common';
import { ClerkAuthService } from './clerk-auth.service';
import { ClerkWebhookController } from './clerk-webhook.controller';
import { ClerkWebhookService } from './clerk-webhook.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ClerkWebhookController],
  providers: [ClerkAuthService, ClerkWebhookService],
  exports: [ClerkAuthService],
})
export class AuthModule {}
