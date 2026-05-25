import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

// Use require() to safely handle CJS/ESM dual-publish packages
// eslint-disable-next-line @typescript-eslint/no-var-requires
const helmet = require('helmet');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const compression = require('compression');

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // Suppress verbose NestJS startup logs in production
    logger:
      process.env.NODE_ENV === 'production'
        ? ['error', 'warn']
        : ['log', 'error', 'warn', 'debug'],
  });

  // ── Security headers (helmet) ────────────────────────────────────────────
  app.use(
    helmet({
      crossOriginEmbedderPolicy: false, // needed for face-api.js WASM
      contentSecurityPolicy: false,     // managed by frontend
    }),
  );

  // ── Response compression ─────────────────────────────────────────────────
  app.use(compression());

  // ── CORS ─────────────────────────────────────────────────────────────────
  // In production set CORS_ORIGIN to your exact frontend domain.
  // Never use '*' in production — it allows any site to call your API.
  const corsOrigin = process.env.CORS_ORIGIN;
  if (!corsOrigin || corsOrigin === '*') {
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        '[SAMS] WARNING: CORS_ORIGIN is not set or is "*" in production. ' +
          'Set CORS_ORIGIN to your frontend domain (e.g. https://sams.indongozi.rw).',
      );
    }
  }
  app.enableCors({
    origin: corsOrigin || '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
  });

  // ── Global prefix ────────────────────────────────────────────────────────
  app.setGlobalPrefix('api');

  // ── Global validation pipe ───────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,           // strip unknown properties
      forbidNonWhitelisted: true, // reject requests with unknown properties
      transform: true,           // auto-transform types (string → number etc.)
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // ── Swagger docs (development only) ─────────────────────────────────────
  // Never expose API docs in production — it reveals your full API surface.
  if (process.env.NODE_ENV !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('SAMS — Indongozi SACCO Attendance API')
      .setDescription('Staff Attendance Management System REST API')
      .setVersion('1.0')
      .addTag('auth', 'Authentication')
      .addTag('recognition', 'Face recognition')
      .addTag('people', 'Employee management')
      .addTag('attendance', 'Attendance records')
      .addTag('reports', 'Reports and analytics')
      .addTag('holidays', 'Public holidays')
      .addTag('stations', 'Branch management')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
    console.log(`Swagger docs: http://localhost:${process.env.PORT || 8000}/api/docs`);
  }

  const port = parseInt(process.env.PORT || '8000', 10);
  await app.listen(port, '0.0.0.0');

  console.log(`SAMS API running on port ${port} [${process.env.NODE_ENV || 'development'}]`);
}

bootstrap();
