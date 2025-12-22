/**
 * 应用入口文件
 */
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  const app = await NestFactory.create(AppModule);

  // 全局验证管道
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // 启用 CORS（如果需要）
  app.enableCors();

  const port = process.env.PORT || 3000;
  await app.listen(port);
  
  logger.log(`🚀 Application is running on: http://localhost:${port}`);
  logger.log(`📝 Webhook endpoints:`);
  logger.log(`   - POST /webhook/gitlab`);
  logger.log(`   - POST /webhook/github`);
}

bootstrap().catch(error => {
  console.error('Failed to start application:', error);
  process.exit(1);
});

