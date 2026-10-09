import 'reflect-metadata';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });
import { NestFactory } from '@nestjs/core';
import { Catch, ExceptionFilter, ArgumentsHost, HttpException } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { ZodError } from 'zod';
import { authenticate } from './auth';
import { pool } from './db';
import { AppModule } from './app.module';
@Catch()
class Errors implements ExceptionFilter {
  catch(e: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    if (res.sent) return;
    let status = 500,
      message = 'Wystąpił błąd serwera. Spróbuj ponownie.';
    if (e instanceof HttpException) {
      status = e.getStatus();
      const r = e.getResponse();
      message = typeof r === 'string' ? r : (r as any).message;
    } else if (e instanceof ZodError) {
      status = 400;
      message =
        'Sprawdź dane: ' +
        e.issues
          .map((x) => x.path.join('.') + ' ' + x.message)
          .slice(0, 3)
          .join('; ');
    } else if (e.code === '23P01') {
      status = 409;
      message = 'Ten termin został właśnie zajęty. Wybierz inne daty.';
    } else if (e.code === '23505') {
      status = 409;
      message = 'Taki wpis już istnieje. Nie zapisaliśmy go drugi raz.';
    } else if (['23503', '23514', '22P02'].includes(e.code)) {
      status = 400;
      message = 'Nieprawidłowe dane lub brak powiązanego wpisu.';
    } else {
      console.error('API error', e.message);
    }
    res.status(status).send({ statusCode: status, message });
  }
}
async function main() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 1024 * 1024, trustProxy: ['127.0.0.1'] }),
    { rawBody: true },
  );
  await app.register(cookie);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 10 } });
  await app.register(rateLimit, {
    max: 600,
    timeWindow: 60000,
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: () => ({
      statusCode: 429,
      message: 'Zbyt wiele żądań. Spróbuj później.',
    }),
  });
  const server = app.getHttpAdapter().getInstance();
  server.addHook('onRequest', async (req) => {
    // Older clients send JSON headers on bodyless POST actions.
    if (
      req.headers['content-length'] === '0' &&
      req.headers['content-type']?.startsWith('application/json')
    )
      delete req.headers['content-type'];
  });
  const loginAttempts = new Map<string, { count: number; until: number }>();
  const resetRequests = new Map<string, { count: number; until: number }>();
  server.addHook('preHandler', async (req, reply) => {
    if (req.url.split('?')[0] === '/api/v1/auth/login') {
      const now = Date.now();
      for (const [key, value] of loginAttempts) if (value.until <= now) loginAttempts.delete(key);
      const bucket = loginAttempts.get(req.ip) || { count: 0, until: now + 15 * 60000 };
      loginAttempts.set(req.ip, bucket);
      if (++bucket.count > 20) {
        reply.status(429).send({ message: 'Zbyt wiele prób logowania. Spróbuj później.' });
        return;
      }
    }
    if (req.method === 'POST' && req.url.split('?')[0] === '/api/v1/auth/forgot') {
      const now = Date.now();
      for (const [key, value] of resetRequests) if (value.until <= now) resetRequests.delete(key);
      const bucket = resetRequests.get(req.ip) || { count: 0, until: now + 15 * 60000 };
      resetRequests.set(req.ip, bucket);
      if (++bucket.count > 20) {
        reply.status(429).send({ message: 'Zbyt wiele próśb o zmianę hasła. Spróbuj później.' });
        return;
      }
    }
    try {
      await authenticate(req);
    } catch (e: any) {
      const expected = e instanceof HttpException;
      reply.status(expected ? e.getStatus() : 500).send({
        message: expected ? e.message : 'Wystąpił błąd serwera. Spróbuj ponownie.',
      });
    }
  });
  app.useGlobalFilters(new Errors());
  app.enableShutdownHooks();
  await app.init();
  if (server.hasContentTypeParser('application/x-www-form-urlencoded'))
    server.removeContentTypeParser('application/x-www-form-urlencoded');
  server.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string', bodyLimit: 128 },
    (req, body, done) => {
      // RFC 8058 is the only form endpoint; other actions retain JSON and CSRF requirements.
      if (
        req.method !== 'POST' ||
        req.url.split('?')[0] !== '/api/v1/newsletter/one-click' ||
        body !== 'List-Unsubscribe=One-Click'
      ) {
        const error = new Error('Nieprawidłowa treść żądania.') as Error & { statusCode: number };
        error.statusCode = 400;
        done(error);
        return;
      }
      done(null, { 'List-Unsubscribe': 'One-Click' });
    },
  );
  await pool.query('SELECT 1');
  await app.listen(Number(process.env.API_PORT || 4100), '127.0.0.1');
  console.log('Vanly API is listening on loopback.');
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
