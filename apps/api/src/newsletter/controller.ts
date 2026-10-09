import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Query,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { z } from 'zod';
import { tx, q, audit } from '../db';
import { user, Authed } from '../auth';
import { confirmNewsletter, unsubscribeNewsletter } from './subscriptions';
const tokenBody = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) });
@Controller('api/v1/newsletter')
export class NewsletterController {
  @Post('confirm') confirm(@Body() body: unknown) {
    const { token } = tokenBody.parse(body);
    return tx((db) => confirmNewsletter(db, token));
  }
  @Post('unsubscribe') unsubscribe(@Body() body: unknown) {
    const { token } = tokenBody.parse(body);
    return tx((db) => unsubscribeNewsletter(db, token));
  }
  @Post('one-click') oneClick(@Query('token') token: string, @Body() body: unknown) {
    z.string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(token);
    z.object({ 'List-Unsubscribe': z.literal('One-Click') }).parse(body);
    return tx((db) => unsubscribeNewsletter(db, token));
  }
  @Get('status') async status(@Req() req: Authed) {
    const u = user(req);
    const [row] = await q(
      'SELECT status,consent_version,requested_at,confirmed_at,unsubscribed_at FROM newsletter_subscriptions WHERE user_id=$1',
      [u.id],
    );
    return row || { status: 'unsubscribed' };
  }
}
@Controller('api/v1/admin/newsletter')
export class NewsletterAdminController {
  @Get('campaigns') async list(@Req() req: Authed) {
    user(req, ['admin']);
    return q('SELECT * FROM newsletter_campaigns ORDER BY created_at DESC LIMIT 100');
  }
  @Post('campaigns') async draft(@Req() req: Authed, @Body() body: unknown) {
    const u = user(req, ['admin']);
    const d = z
      .object({
        articleId: z.string().min(1).max(80),
        subject: z
          .string()
          .trim()
          .min(3)
          .max(200)
          .refine((s) => !/[\r\n]/.test(s)),
      })
      .parse(body);
    return tx(async (db) => {
      const [article] = await q(
        'SELECT id FROM articles WHERE id=$1 AND published=true',
        [d.articleId],
        db,
      );
      if (!article) throw new BadRequestException('Kampania wymaga opublikowanego artykułu.');
      const [campaign] = await q(
        'INSERT INTO newsletter_campaigns(article_id,subject,created_by) VALUES($1,$2,$3) RETURNING *',
        [d.articleId, d.subject, u.id],
        db,
      );
      await audit(db, u, 'newsletter.campaign_drafted', campaign.id);
      return campaign;
    });
  }
  @Post('campaigns/approve') async approve(@Req() req: Authed, @Body() body: unknown) {
    const u = user(req, ['admin']);
    const { campaignId } = z.object({ campaignId: z.uuid() }).parse(body);
    return tx(async (db) => {
      const [campaign] = await q(
        `UPDATE newsletter_campaigns SET status='ready',approved_at=now()
        WHERE id=$1 AND status='draft' AND EXISTS(SELECT 1 FROM articles WHERE id=article_id AND published=true) RETURNING *`,
        [campaignId],
        db,
      );
      if (!campaign) throw new ConflictException('Kampania nie jest gotowa do zatwierdzenia.');
      await audit(db, u, 'newsletter.campaign_approved', campaignId);
      return campaign;
    });
  }
  @Post('campaigns/cancel') async cancel(@Req() req: Authed, @Body() body: unknown) {
    const u = user(req, ['admin']);
    const { campaignId } = z.object({ campaignId: z.uuid() }).parse(body);
    return tx(async (db) => {
      const [campaign] = await q(
        "UPDATE newsletter_campaigns SET status='cancelled' WHERE id=$1 AND status IN('draft','ready','completed') RETURNING *",
        [campaignId],
        db,
      );
      if (!campaign) throw new ConflictException('Kampania nie może zostać anulowana.');
      await audit(db, u, 'newsletter.campaign_cancelled', campaignId);
      return campaign;
    });
  }
}
