import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

type InternalRequest = Request & { rawBody?: Buffer };

@Injectable()
export class InternalWebhookGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<InternalRequest>();
    const expectedToken = process.env.INTERNAL_WEBHOOK_TOKEN?.trim();
    if (!expectedToken) {
      throw new ServiceUnavailableException(
        'INTERNAL_WEBHOOK_TOKEN no está configurado en el servidor.',
      );
    }

    const token = req.header('x-internal-token')?.trim();
    if (!token || !this.safeEqual(token, expectedToken)) {
      throw new UnauthorizedException('Invalid internal token.');
    }

    const hmacSecret = process.env.INTERNAL_WEBHOOK_HMAC_SECRET?.trim();
    if (!hmacSecret) return true;

    const signature = req.header('x-signature')?.trim();
    if (!signature) {
      throw new UnauthorizedException('Missing signature.');
    }

    const expectedSignature = createHmac('sha256', hmacSecret)
      .update(req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}), 'utf8'))
      .digest('hex');

    if (!this.safeEqual(signature, expectedSignature)) {
      throw new UnauthorizedException('Invalid signature.');
    }

    return true;
  }

  private safeEqual(a: string, b: string): boolean {
    const aBuf = Buffer.from(a, 'utf8');
    const bBuf = Buffer.from(b, 'utf8');
    if (aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
  }
}
