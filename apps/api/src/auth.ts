import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Req,
  Res,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import type { FastifyRequest as Request, FastifyReply as Response } from 'fastify';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import { q, pool, tx, audit } from './db';
import { allowedAppOrigins, trustedRequestOrigin } from './request-origin';
import { notifyWelcome, notifyPasswordChanged } from './notifications/account';
import { requestPasswordReset } from './accounts/password-recovery';
import { requestEmailVerification, verifyEmail } from './accounts/email-verification';
import { updateNewsletterPreference } from './newsletter/subscriptions';
const scrypt = promisify(crypto.scrypt);
export const digest = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const random = () => crypto.randomBytes(32).toString('hex');
export async function hash(password: string) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + ((await scrypt(password, salt, 64)) as Buffer).toString('hex');
}
async function valid(password: string, stored: string) {
  const [salt, h] = stored.split(':');
  const d = (await scrypt(password, salt, 64)) as Buffer;
  return (
    d.length === Buffer.from(h, 'hex').length && crypto.timingSafeEqual(d, Buffer.from(h, 'hex'))
  );
}
export type User = {
  id: string;
  email: string;
  name: string;
  role: 'traveler' | 'owner' | 'admin';
  company_id: string | null;
  profile: any;
  email_verified_at?: string | null;
};
export type Authed = Request & { user?: User; session?: any };
// The local Nginx proxy overwrites this header; the API stays on loopback.
// Separate cookies keep the optional HTTP address from overwriting an HTTPS session.
function sessionCookie(req: Request) {
  return req.headers['x-vanly-protocol'] === 'https' ? '__Host-vanly_session' : 'vanly_session';
}
export function user(req: Authed, roles?: string[]): User {
  if (!req.user) throw new UnauthorizedException('Zaloguj się, aby kontynuować.');
  if (roles && !roles.includes(req.user.role))
    throw new ForbiddenException('Nie masz dostępu do tego widoku.');
  return req.user;
}
export function companyScope(u: User, company: string) {
  if (u.role !== 'admin' && (u.role !== 'owner' || u.company_id !== company))
    throw new ForbiddenException('Nie masz dostępu do tej firmy.');
}
export async function authenticate(req: Authed) {
  const token = req.cookies?.[sessionCookie(req)];
  if (token && typeof token === 'string') {
    const rows = await q(
      `SELECT s.csrf,s.token_hash,u.id,u.email,u.name,u.role,u.company_id,u.profile,u.email_verified_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`,
      [digest(token)],
    );
    if (rows[0]) {
      const { csrf, token_hash, ...u } = rows[0];
      req.user = u;
      req.session = { csrf, token_hash };
    }
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    // RFC 8058 calls carry an unguessable unsubscribe token and never touch
    // account/session state. This exact POST endpoint alone is CSRF-exempt.
    if (req.method === 'POST' && req.url.split('?')[0] === '/api/v1/newsletter/one-click') return;
    const origin = req.headers.origin;
    const allowed = allowedAppOrigins();
    if (!origin || !allowed.includes(origin))
      throw new ForbiddenException('Nieprawidłowe źródło żądania.');
    if (req.user && req.headers['x-csrf-token'] !== req.session.csrf)
      throw new ForbiddenException('Odśwież stronę i spróbuj ponownie.');
  }
}
async function startSession(u: User, req: Request, res: Response) {
  const token = random(),
    csrf = random();
  await pool.query(
    "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",
    [digest(token), u.id, csrf],
  );
  res.setCookie(sessionCookie(req), token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: sessionCookie(req).startsWith('__Host-'),
    maxAge: 7 * 86400,
    path: '/',
  });
  return { user: u, csrf };
}
const credentials = z.object({
  email: z
    .email()
    .max(160)
    .transform((s) => s.toLowerCase().trim()),
  password: z.string().min(10).max(128),
});
@Controller('api/v1/auth')
export class AuthController {
  @Get('me') async me(@Req() req: Authed) {
    return {
      user: req.user || null,
      csrf: req.session?.csrf || null,
      localPayments: process.env.LOCAL_PAYMENTS === 'true',
    };
  }
  @Post('register') async register(
    @Body() body: unknown,
    @Req() req: Authed,
    @Res({ passthrough: true }) res: Response,
  ) {
    const d = credentials.extend({ name: z.string().trim().min(2).max(100) }).parse(body);
    const passwordHash = await hash(d.password);
    const u = await tx(async (db) => {
      const [account] = await q<User>(
        `INSERT INTO users(email,name,password_hash) VALUES($1,$2,$3) RETURNING id,email,name,role,company_id,profile,email_verified_at`,
        [d.email, d.name, passwordHash],
        db,
      );
      await notifyWelcome(db, account);
      await requestEmailVerification(db, account, trustedRequestOrigin(req));
      return account;
    });
    return startSession(u, req, res);
  }
  @Post('login') async login(
    @Body() body: unknown,
    @Req() req: Authed,
    @Res({ passthrough: true }) res: Response,
  ) {
    const d = credentials.parse(body),
      [r] = await q('SELECT * FROM users WHERE email=$1', [d.email]);
    if (!r || !(await valid(d.password, r.password_hash)))
      throw new UnauthorizedException('Nieprawidłowy e-mail lub hasło.');
    const { password_hash, ...u } = r;
    return startSession(u, req, res);
  }
  @Post('logout') async logout(@Req() req: Authed, @Res({ passthrough: true }) res: Response) {
    if (req.session)
      await pool.query('DELETE FROM sessions WHERE token_hash=$1', [req.session.token_hash]);
    res.clearCookie(sessionCookie(req), {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: sessionCookie(req).startsWith('__Host-'),
    });
    return { ok: true };
  }
  @Patch('profile') async profile(@Req() req: Authed, @Body() body: unknown) {
    const u = user(req);
    const d = z
      .object({
        name: z.string().trim().min(2).max(100),
        phone: z.string().max(30).default(''),
        drivers: z
          .array(
            z.object({
              name: z.string().min(2).max(100),
              country: z.string().max(50),
              licenseCategory: z.string().max(10),
            }),
          )
          .max(5)
          .default([]),
        marketing: z.boolean().default(false),
      })
      .parse(body);
    return tx(async (db) => {
      const newsletterStatus = await updateNewsletterPreference(
        db,
        { id: u.id, name: d.name },
        d.marketing,
        trustedRequestOrigin(req),
      );
      const [updated] = await q(
        'UPDATE users SET name=$1,profile=$2 WHERE id=$3 RETURNING id,email,name,role,company_id,profile,email_verified_at',
        [
          d.name,
          JSON.stringify({ ...d, marketing: newsletterStatus === 'confirmed', newsletterStatus }),
          u.id,
        ],
        db,
      );
      await audit(db, u, 'profile.updated', u.id);
      return updated;
    });
  }
  @Post('verify-email') async verifyAddress(@Body() body: unknown) {
    const { token } = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).parse(body);
    return tx((db) => verifyEmail(db, token));
  }
  @Post('resend-verification') async resendVerification(@Req() req: Authed) {
    const u = user(req);
    await tx((db) => requestEmailVerification(db, u, trustedRequestOrigin(req)));
    return {
      ok: true,
      message:
        'Jeśli adres wymaga potwierdzenia, otrzymasz nowy link. Kolejną prośbę można wysłać po 5 minutach.',
    };
  }
  @Post('forgot') async forgot(@Body() body: unknown, @Req() req: Authed) {
    const d = z.object({ email: z.string().trim().pipe(z.email().max(160)) }).parse(body);
    await requestPasswordReset(d.email.toLowerCase(), trustedRequestOrigin(req));
    return {
      message:
        process.env.MAIL_PROVIDER === 'ses' && process.env.MAIL_SES_ENABLED === 'true'
          ? 'Jeśli konto istnieje, wyślemy wiadomość z linkiem do ustawienia nowego hasła.'
          : 'Jeśli konto istnieje, link pojawi się w lokalnej skrzynce pocztowej.',
    };
  }
  @Post('reset') async reset(@Body() body: unknown) {
    const d = z
      .object({ token: z.string().length(64), password: z.string().min(10).max(128) })
      .parse(body);
    await tx(async (db) => {
      const [candidate] = await q(
        'SELECT user_id FROM reset_tokens WHERE token_hash=$1',
        [digest(d.token)],
        db,
      );
      if (!candidate) throw new BadRequestException('Link wygasł albo został wykorzystany.');
      // Match the lock order used by reset requests; concurrent valid links cannot race.
      await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [candidate.user_id]);
      const [t] = await q(
        'SELECT * FROM reset_tokens WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() FOR UPDATE',
        [digest(d.token)],
        db,
      );
      if (!t) throw new BadRequestException('Link wygasł albo został wykorzystany.');
      await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [
        await hash(d.password),
        t.user_id,
      ]);
      await db.query('UPDATE reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL', [
        t.user_id,
      ]);
      await db.query('DELETE FROM sessions WHERE user_id=$1', [t.user_id]);
      await notifyPasswordChanged(db, t.user_id, t.token_hash);
    });
    return { ok: true };
  }
}
