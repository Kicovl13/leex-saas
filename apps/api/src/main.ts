import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, RequestMethod } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { validateEnv } from './common/env';
import type { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
  validateEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true, // Necesario para verificación de firma Svix en POST /auth/webhooks/clerk
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors();
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'auth/webhooks/clerk', method: RequestMethod.POST },
    ],
  });

  const config = new DocumentBuilder()
    .setTitle('LEX-CLOUD API')
    .setDescription('API del SaaS legal multi-tenant. Requiere Authorization: Bearer &lt;token Clerk&gt; en rutas protegidas.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document);

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
