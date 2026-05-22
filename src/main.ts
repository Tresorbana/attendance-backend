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
  const app = await NestFactory.create(AppModule);

  // Security headers
  app.use(helmet());

  // Response compression
  app.use(compression());

  // CORS — allow the Vite dev server and any configured origin
  app.enableCors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // All routes are prefixed with /api
  app.setGlobalPrefix('api');

  // Validate & transform incoming request bodies
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  );

  // Swagger UI at /api/docs
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Attendance API')
    .setDescription('Face recognition attendance system REST API')
    .setVersion('1.0')
    .addTag('recognition', 'Face recognition')
    .addTag('people', 'Enrolled persons management')
    .addTag('attendance', 'Attendance records')
    .addTag('reports', 'Reports and analytics')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = parseInt(process.env.PORT || '8000', 10);
  await app.listen(port);

  console.log(`\nAttendance API running on http://localhost:${port}`);
  console.log(`Swagger docs:          http://localhost:${port}/api/docs`);
  console.log(`Health check:          http://localhost:${port}/api/health\n`);
}

bootstrap();
