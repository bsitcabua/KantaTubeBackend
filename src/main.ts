import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { urlencoded, json } from 'express'; // MUST IMPORT THIS

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  // Get environment variables
  const PORT = configService.get<number>('PORT') || 3000;
  const ALLOWED_ORIGINS = [
    `http://localhost:4200`,
    'http://localhost',
    `http://192.168.1.18`,
    `http://192.168.1.4`,
    'https://kantatube.vercel.app',
    'https://kantatube-git-staging-elvins-projects-39449bae.vercel.app',
    'https://kantatube-git-development-elvins-projects-39449bae.vercel.app'
  ];
  app.enableCors({
    origin: ALLOWED_ORIGINS,
    methods: 'GET,POST,PUT,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Authorization',
    credentials: true,
  });

  // ADD THIS to allow payloads up to 50mb (or larger)
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));
  
  // Set global API prefix for all routes
  app.setGlobalPrefix('api');

  // Log CORS settings & server status
  console.log(`✅ CORS enabled for: ${ALLOWED_ORIGINS}`);
  console.log(`🚀 Server running on http://localhost:${PORT}/api`);
  console.log(`App listening to: ${PORT}`);
  
  await app.listen(PORT);
}
bootstrap();
