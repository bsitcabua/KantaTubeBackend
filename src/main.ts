import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  // Get environment variables
  const PORT = configService.get<number>('PORT') || 3000;
  const ALLOWED_ORIGINS = [
    'http://localhost:4200',
    'http://192.168.1.18:4200',
    'https://kantatube.vercel.app',
    'https://kantatube.vercel.app:4200',
    'kantabackend-production.up.railway.app',
    'kantabackend-production.up.railway.app:4200'
  ];
  app.enableCors({
    origin: ALLOWED_ORIGINS,
    methods: 'GET,POST,PUT,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Authorization',
    credentials: true,
  });
  
  // Set global API prefix for all routes
  app.setGlobalPrefix('api');

  // Log CORS settings & server status
  console.log(`✅ CORS enabled for: ${ALLOWED_ORIGINS}`);
  console.log(`🚀 Server running on http://localhost:${PORT}/api`);
  console.log(`App listening to: ${PORT}`);
  
  await app.listen(PORT);
}
bootstrap();
