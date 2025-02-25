import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  // Get environment variables
  const PORT = configService.get<number>('PORT') || 3000;
  const ALLOWED_ORIGIN = configService.get<string>('CORS_ORIGIN') || 'http://localhost:4200';

  // Enable CORS for frontend requests
  app.enableCors({
    origin: ALLOWED_ORIGIN,
    methods: 'GET,POST,PUT,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Authorization',
    credentials: true, // Enable cookies if needed
  });

  // Set global API prefix for all routes
  app.setGlobalPrefix('api');

  // Log CORS settings & server status
  console.log(`✅ CORS enabled for: ${ALLOWED_ORIGIN}`);
  console.log(`🚀 Server running on http://localhost:${PORT}/api`);
  console.log(`App listening to: ${PORT}`);
  
  await app.listen(PORT);
}
bootstrap();
