import { Controller, Post, Req, Res, Logger } from '@nestjs/common';
import { Request } from 'express';
import type { Response } from 'express';
import { ClerkWebhookService } from './clerk-webhook.service';

/**
 * Peticiones a esta ruta NO pasan por TenantMiddleware (auth no está en forRoutes).
 * No se aplica TenantGuard: el webhook se autoriza mediante firma Svix.
 */
@Controller('auth/webhooks')
export class ClerkWebhookController {
  private readonly logger = new Logger(ClerkWebhookController.name);

  constructor(private readonly webhook: ClerkWebhookService) {}

  @Post('clerk')
  async handleClerkWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Res() res: Response,
  ): Promise<void> {
    const rawBody = req.rawBody;
    if (!rawBody || !Buffer.isBuffer(rawBody)) {
      this.logger.warn('Webhook received without raw body (ensure rawBody: true in NestFactory.create)');
      res.status(400).json({ error: 'Missing raw body' });
      return;
    }

    const svixId = req.headers['svix-id'] as string | undefined;
    const svixTimestamp = req.headers['svix-timestamp'] as string | undefined;
    const svixSignature = req.headers['svix-signature'] as string | undefined;

    if (!svixId || !svixTimestamp || !svixSignature) {
      this.logger.warn('Webhook missing Svix headers');
      res.status(400).json({ error: 'Missing svix-id, svix-timestamp or svix-signature' });
      return;
    }

    try {
      const payload = this.webhook.verifyPayload(rawBody, {
        'svix-id': svixId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': svixSignature,
      });
      await this.webhook.handleEvent(payload);
      res.status(200).json({ received: true });
    } catch (err) {
      this.logger.error('Webhook verification or processing failed', err);
      res.status(400).json({ error: 'Webhook verification failed' });
    }
  }
}
