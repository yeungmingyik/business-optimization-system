import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import { AppModule } from './app.module';
import { ErrorFilter } from './error.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.use(json({ limit: '2mb' }));
  app.use((req: any, res: any, next: any) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
  await app.listen(
    Number(process.env.BOS_API_PORT ?? 3000),
    process.env.BOS_API_HOST ?? '127.0.0.1',
  );
}
bootstrap().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
