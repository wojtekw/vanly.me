import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Req,
  Query,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { z } from 'zod';
import { q, pool, tx, audit } from './db';
import { notifyPublicReply, notifyReportUpdated } from './notifications/community';
import { user, Authed, companyScope } from './auth';
import { accessibleBooking } from './bookings';
import {
  notifyCommentReceived,
  notifyCommentModerated,
  notifyReportReceived,
  notifyCompanyStatus,
} from './notifications/service-events';
import crypto from 'node:crypto';
@Controller('api/v1')
export class CommunityController {
  @Post('vehicles/:id/questions') async question(
    @Req() req: Authed,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const u = user(req),
      d = z.object({ text: z.string().trim().min(5).max(1500) }).parse(body);
    return tx(async (db) => {
      const [v] = await q(
        `SELECT v.id FROM vehicles v JOIN companies c ON c.id=v.company_id
        WHERE v.id=$1 AND v.status='published' AND c.verified FOR SHARE OF v,c`,
        [id],
        db,
      );
      if (!v) throw new NotFoundException('Oferta jest niedostępna.');
      const [c] = await q(
        "INSERT INTO comments(vehicle_id,author_id,type,text) VALUES($1,$2,'question',$3) RETURNING *",
        [id, u.id, d.text],
        db,
      );
      await audit(db, u, 'question.created', c.id);
      await notifyCommentReceived(db, c);
      return c;
    });
  }
  @Post('bookings/:id/review') async review(
    @Req() req: Authed,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const u = user(req),
      d = z
        .object({
          text: z.string().trim().min(10).max(2000),
          rating: z.number().int().min(1).max(5),
        })
        .parse(body);
    const b = await accessibleBooking(pool, u, id);
    if (b.user_id !== u.id || b.status !== 'completed')
      throw new ForbiddenException('Opinię można dodać po własnym zakończonym wynajmie.');
    return tx(async (db) => {
      const [c] = await q(
        "INSERT INTO comments(vehicle_id,author_id,booking_id,type,text,rating) VALUES($1,$2,$3,'review',$4,$5) RETURNING *",
        [b.vehicle_id, u.id, id, d.text, d.rating],
        db,
      );
      await audit(db, u, 'review.created', c.id);
      await notifyCommentReceived(db, c);
      return c;
    });
  }
  @Get('owner/comments') async ownerComments(@Req() req: Authed) {
    const u = user(req, ['owner']);
    return q(
      `SELECT r.*,v.name vehicle_name,us.name author FROM comments r JOIN vehicles v ON v.id=r.vehicle_id JOIN users us ON us.id=r.author_id WHERE v.company_id=$1 ORDER BY r.created_at DESC`,
      [u.company_id],
    );
  }
  @Post('comments/:id/reply') async reply(
    @Req() req: Authed,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const u = user(req, ['owner']),
      d = z.object({ text: z.string().trim().min(3).max(2000) }).parse(body);
    return tx(async (db) => {
      const [r] = await q(
        'SELECT r.*,v.company_id FROM comments r JOIN vehicles v ON v.id=r.vehicle_id WHERE r.id=$1 FOR UPDATE OF r',
        [z.uuid().parse(id)],
        db,
      );
      if (!r) throw new NotFoundException();
      companyScope(u, r.company_id);
      await q('UPDATE comments SET reply=$1,reply_by=$2 WHERE id=$3', [d.text, u.id, id], db);
      await audit(db, u, 'comment.reply', id);
      if (r.status === 'published' && r.reply !== d.text) await notifyPublicReply(db, r, d.text);
      return { ok: true };
    });
  }
  @Post('reports') async report(@Req() req: Authed, @Body() body: unknown) {
    const u = user(req),
      d = z
        .object({
          bookingId: z.uuid().optional(),
          commentId: z.uuid().optional(),
          subject: z.string().trim().min(3).max(120),
          description: z.string().trim().min(10).max(3000),
        })
        .parse(body);
    if (d.bookingId) await accessibleBooking(pool, u, d.bookingId);
    return tx(async (db) => {
      const [r] = await q(
        'INSERT INTO reports(user_id,booking_id,comment_id,subject,description) VALUES($1,$2,$3,$4,$5) RETURNING *',
        [u.id, d.bookingId || null, d.commentId || null, d.subject, d.description],
        db,
      );
      await audit(db, u, 'report.created', r.id);
      await notifyReportReceived(db, r);
      return r;
    });
  }
  @Get('reports') async reports(@Req() req: Authed) {
    const u = user(req);
    return q('SELECT * FROM reports WHERE user_id=$1 ORDER BY created_at DESC', [u.id]);
  }
  @Get('messages') async messages(@Req() req: Authed, @Query() p: any) {
    const u = user(req);
    if (p.vehicle) {
      const [v] = await q('SELECT * FROM vehicles WHERE id=$1', [p.vehicle]);
      if (!v) throw new NotFoundException();
      let travelerId = u.id;
      if (p.traveler) {
        user(req, ['owner']);
        companyScope(u, v.company_id);
        travelerId = z.uuid().parse(p.traveler);
      }
      return tx(async (db) => {
        const rows = await q(
          `SELECT m.*,u.name author FROM messages m JOIN users u ON u.id=m.author_id WHERE m.vehicle_id=$1 AND m.traveler_id=$2 ORDER BY m.created_at`,
          [v.id, travelerId],
          db,
        );
        if (rows.length)
          await db.query(
            `INSERT INTO message_reads(vehicle_id,traveler_id,user_id,read_through)
        SELECT $1,$2,$3,max(created_at) FROM messages WHERE id=ANY($4::uuid[])
        ON CONFLICT(vehicle_id,traveler_id,user_id) DO UPDATE
        SET read_through=GREATEST(message_reads.read_through,EXCLUDED.read_through),updated_at=now()`,
            [v.id, travelerId, u.id, rows.map((r) => r.id)],
          );
        return rows;
      });
    }
    if (p.scope === 'company') {
      user(req, ['owner']);
      return q(
        `SELECT latest.* FROM (
          SELECT DISTINCT ON(m.vehicle_id,m.traveler_id) m.*,v.name vehicle_name,t.name traveler_name,a.name author,
            mc.resolved_at,mc.resolved_by,
            CASE WHEN mc.resolved_at IS NOT NULL THEN 'resolved'
              WHEN m.author_id=m.traveler_id THEN 'needs_reply' ELSE 'awaiting_reply' END conversation_status
          FROM messages m JOIN vehicles v ON v.id=m.vehicle_id
          JOIN users t ON t.id=m.traveler_id JOIN users a ON a.id=m.author_id
          LEFT JOIN message_conversations mc ON mc.vehicle_id=m.vehicle_id AND mc.traveler_id=m.traveler_id
          WHERE v.company_id=$1 ORDER BY m.vehicle_id,m.traveler_id,m.created_at DESC,m.id DESC
        ) latest ORDER BY latest.created_at DESC,latest.id DESC`,
        [u.company_id],
      );
    }
    return q(
      `SELECT latest.* FROM (
        SELECT DISTINCT ON(m.vehicle_id,m.traveler_id) m.*,v.name vehicle_name,c.name company_name,t.name traveler_name,a.name author,
          mc.resolved_at,mc.resolved_by,
          CASE WHEN mc.resolved_at IS NOT NULL THEN 'resolved'
            WHEN m.author_id!=m.traveler_id THEN 'needs_reply' ELSE 'awaiting_reply' END conversation_status
        FROM messages m JOIN vehicles v ON v.id=m.vehicle_id JOIN companies c ON c.id=v.company_id
        JOIN users t ON t.id=m.traveler_id JOIN users a ON a.id=m.author_id
        LEFT JOIN message_conversations mc ON mc.vehicle_id=m.vehicle_id AND mc.traveler_id=m.traveler_id
        WHERE m.traveler_id=$1 ORDER BY m.vehicle_id,m.traveler_id,m.created_at DESC,m.id DESC
      ) latest ORDER BY latest.created_at DESC,latest.id DESC`,
      [u.id],
    );
  }
  @Patch('messages/status') async messageStatus(@Req() req: Authed, @Body() body: unknown) {
    const u = user(req, ['owner']),
      d = z
        .object({
          vehicleId: z.string().trim().min(1).max(80),
          travelerId: z.uuid(),
          resolved: z.boolean(),
        })
        .parse(body);
    const [v] = await q('SELECT * FROM vehicles WHERE id=$1', [d.vehicleId]);
    if (!v) throw new NotFoundException();
    companyScope(u, v.company_id);
    return tx(async (db) => {
      await q(
        `INSERT INTO message_conversations(vehicle_id,traveler_id)
          SELECT $1,$2 WHERE EXISTS(SELECT 1 FROM messages WHERE vehicle_id=$1 AND traveler_id=$2)
          ON CONFLICT(vehicle_id,traveler_id) DO NOTHING`,
        [v.id, d.travelerId],
        db,
      );
      const [conversation] = await q(
        'SELECT * FROM message_conversations WHERE vehicle_id=$1 AND traveler_id=$2 FOR UPDATE',
        [v.id, d.travelerId],
        db,
      );
      if (!conversation) throw new NotFoundException('Ta rozmowa nie istnieje.');
      const [latest] = await q(
        'SELECT author_id FROM messages WHERE vehicle_id=$1 AND traveler_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1',
        [v.id, d.travelerId],
        db,
      );
      if (!latest) throw new NotFoundException('Ta rozmowa nie istnieje.');
      const [updated] = await q(
        `UPDATE message_conversations SET resolved_at=CASE WHEN $3 THEN clock_timestamp() ELSE NULL END,
          resolved_by=CASE WHEN $3 THEN $4::uuid ELSE NULL END,updated_at=clock_timestamp()
          WHERE vehicle_id=$1 AND traveler_id=$2 RETURNING *`,
        [v.id, d.travelerId, d.resolved, u.id],
        db,
      );
      await audit(db, u, 'message.conversation_status', v.id, {
        travelerId: d.travelerId,
        resolved: d.resolved,
      });
      return {
        ...updated,
        conversation_status: d.resolved
          ? 'resolved'
          : latest.author_id === conversation.traveler_id
            ? 'needs_reply'
            : 'awaiting_reply',
      };
    });
  }
  @Post('messages') async sendMessage(@Req() req: Authed, @Body() body: unknown) {
    const u = user(req),
      d = z
        .object({
          vehicleId: z.string().min(1).max(80),
          travelerId: z.uuid().optional(),
          text: z.string().trim().min(1).max(3000),
        })
        .parse(body);
    return tx(async (db) => {
      const [v] = await q(
        `SELECT v.*,c.verified FROM vehicles v JOIN companies c ON c.id=v.company_id
        WHERE v.id=$1 FOR SHARE OF v,c`,
        [d.vehicleId],
        db,
      );
      if (!v) throw new NotFoundException();
      let travelerId = u.id;
      if (d.travelerId && u.role === 'owner') {
        companyScope(u, v.company_id);
        travelerId = d.travelerId;
      } else if (d.travelerId && d.travelerId !== u.id) throw new ForbiddenException();
      const [conversation] = await q(
        'SELECT 1 FROM messages WHERE vehicle_id=$1 AND traveler_id=$2 LIMIT 1',
        [v.id, travelerId],
        db,
      );
      if (travelerId !== u.id && !conversation)
        throw new ForbiddenException('Ta rozmowa nie istnieje.');
      if ((v.status !== 'published' || !v.verified) && !conversation) {
        const [booking] = await q(
          `SELECT 1 FROM bookings WHERE vehicle_id=$1 AND user_id=$2
          AND status IN('pending','confirmed','in_rental','completed') LIMIT 1`,
          [v.id, u.id],
          db,
        );
        if (!booking) throw new NotFoundException('Oferta jest niedostępna.');
      }
      await q(
        'INSERT INTO message_conversations(vehicle_id,traveler_id) VALUES($1,$2) ON CONFLICT(vehicle_id,traveler_id) DO NOTHING',
        [v.id, travelerId],
        db,
      );
      // Sending and resolving share this lock, so the last action determines the thread state.
      await q(
        'SELECT 1 FROM message_conversations WHERE vehicle_id=$1 AND traveler_id=$2 FOR UPDATE',
        [v.id, travelerId],
        db,
      );
      const [m] = await q(
        'INSERT INTO messages(vehicle_id,traveler_id,author_id,text,created_at) VALUES($1,$2,$3,$4,clock_timestamp()) RETURNING *',
        [v.id, travelerId, u.id, d.text],
        db,
      );
      await q(
        'UPDATE message_conversations SET resolved_at=NULL,resolved_by=NULL,updated_at=clock_timestamp() WHERE vehicle_id=$1 AND traveler_id=$2',
        [v.id, travelerId],
        db,
      );
      await audit(db, u, 'message.created', m.id, { vehicleId: v.id, travelerId });
      await db.query(
        `INSERT INTO message_reads(vehicle_id,traveler_id,user_id,read_through)
        SELECT $1,$2,$3,created_at FROM messages WHERE id=$4
        ON CONFLICT(vehicle_id,traveler_id,user_id) DO UPDATE
        SET read_through=GREATEST(message_reads.read_through,EXCLUDED.read_through),updated_at=now()`,
        [v.id, travelerId, u.id, m.id],
      );
      // The worker aggregates unread messages after a short window, then checks
      // read receipts again before delivery. No immediate mail per chat bubble.
      return m;
    });
  }
}
@Controller('api/v1/admin')
export class AdminController {
  @Get('dashboard') async dashboard(@Req() req: Authed) {
    user(req, ['admin']);
    const bookings = await q(
      `SELECT b.*,v.name vehicle_name,v.asset,c.name company_name FROM bookings b JOIN vehicles v ON v.id=b.vehicle_id JOIN companies c ON c.id=b.company_id WHERE b.status!='held' AND b.status!='expired' ORDER BY b.created_at DESC LIMIT 150`,
    );
    const companies = await q(
      `SELECT c.*,(SELECT count(*)::int FROM vehicles v WHERE v.company_id=c.id) vehicle_count,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('vehicle_id',f.vehicle_id,'vehicle_name',v.name,'amount_minor',f.amount_minor,'status',f.status,'paid_at',f.paid_at) ORDER BY f.created_at)
          FROM vehicle_listing_fees f JOIN vehicles v ON v.id=f.vehicle_id WHERE f.company_id=c.id),'[]'::jsonb) listing_fees
        FROM companies c ORDER BY c.name`,
    );
    const comments = await q(
      `SELECT r.*,u.name author,v.name vehicle_name FROM comments r JOIN users u ON u.id=r.author_id JOIN vehicles v ON v.id=r.vehicle_id ORDER BY r.created_at DESC LIMIT 150`,
    );
    const reports = await q(
      'SELECT r.*,u.name author FROM reports r JOIN users u ON u.id=r.user_id ORDER BY r.created_at DESC LIMIT 100',
    );
    const jobs = await q(
      'SELECT id,kind,status,attempts,error,created_at FROM jobs ORDER BY id DESC LIMIT 50',
    );
    const auditLog = await q(
      'SELECT a.*,u.name actor FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 100',
    );
    const articles = await q('SELECT * FROM articles ORDER BY updated_at DESC');
    const stats = (
      await q(
        `SELECT (SELECT count(*) FROM users)::int users,(SELECT count(*) FROM vehicles)::int vehicles,(SELECT count(*) FROM bookings WHERE status IN('pending','confirmed','in_rental','completed'))::int bookings,(SELECT coalesce(sum(total_minor),0)::bigint FROM bookings WHERE status IN('pending','confirmed','in_rental','completed')) total_minor`,
      )
    )[0];
    return {
      bookings,
      companies,
      comments,
      reports,
      jobs,
      audit: auditLog,
      articles,
      stats,
      integrations: {
        payments: process.env.LOCAL_PAYMENTS === 'true' ? 'local_test' : 'disabled',
        insurance: 'not_connected',
        vignettes: 'not_connected',
        email:
          process.env.MAIL_PROVIDER === 'ses' && process.env.MAIL_SES_ENABLED === 'true'
            ? 'ses_outbox'
            : 'local_outbox',
      },
    };
  }
  @Post('companies/:id/verify') async verify(
    @Req() req: Authed,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const u = user(req, ['admin']),
      d = z.object({ verified: z.boolean(), reason: z.string().min(5).max(1000) }).parse(body);
    return tx(async (db) => {
      const [previous] = await q('SELECT * FROM companies WHERE id=$1 FOR UPDATE', [id], db);
      if (!previous) throw new NotFoundException();
      if (previous.verified === d.verified) return previous;
      const [c] = await q(
        'UPDATE companies SET verified=$1 WHERE id=$2 RETURNING *',
        [d.verified, id],
        db,
      );
      await audit(db, u, 'company.verified', id, d);
      await notifyCompanyStatus(db, c, crypto.randomUUID());
      return c;
    });
  }
  @Post('comments/:id/moderate') async moderate(
    @Req() req: Authed,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const u = user(req, ['admin']),
      d = z
        .object({
          status: z.enum(['published', 'hidden', 'rejected']),
          reason: z.string().trim().min(5).max(1000),
        })
        .parse(body);
    return tx(async (db) => {
      const [previous] = await q(
        'SELECT status,reason FROM comments WHERE id=$1 FOR UPDATE',
        [z.uuid().parse(id)],
        db,
      );
      const [c] = await q(
        'UPDATE comments SET status=$1,reason=$2 WHERE id=$3 RETURNING *',
        [d.status, d.reason, z.uuid().parse(id)],
        db,
      );
      if (!c) throw new NotFoundException();
      await audit(db, u, 'comment.moderated', id, d);
      if (previous?.status !== c.status || previous?.reason !== c.reason)
        await notifyCommentModerated(db, c);
      if (c.status === 'published' && c.reply) await notifyPublicReply(db, c, c.reply);
      return c;
    });
  }
  @Post('reports/:id/resolve') async resolve(
    @Req() req: Authed,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const u = user(req, ['admin']),
      d = z
        .object({
          status: z.enum(['in_progress', 'resolved']),
          resolution: z.string().trim().min(5).max(3000),
        })
        .parse(body);
    return tx(async (db) => {
      const [r] = await q(
        'UPDATE reports SET status=$1,resolution=$2 WHERE id=$3 RETURNING *',
        [d.status, d.resolution, z.uuid().parse(id)],
        db,
      );
      if (!r) throw new NotFoundException();
      await audit(db, u, 'report.updated', id, d);
      await notifyReportUpdated(db, r);
      return r;
    });
  }
  @Patch('articles/:id') async article(
    @Req() req: Authed,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const u = user(req, ['admin']),
      d = z
        .object({
          title: z.string().min(5).max(160),
          summary: z.string().min(10).max(500),
          kind: z.enum(['guide', 'inspiration']),
          body: z
            .array(z.tuple([z.string().min(2).max(150), z.string().min(5).max(3000)]))
            .min(1)
            .max(20),
          published: z.boolean(),
        })
        .parse(body);
    return tx(async (db) => {
      const [a] = await q(
        'UPDATE articles SET title=$1,summary=$2,kind=$3,body=$4,published=$5,updated_at=now() WHERE id=$6 RETURNING *',
        [d.title, d.summary, d.kind, JSON.stringify(d.body), d.published, id],
        db,
      );
      if (!a) throw new NotFoundException();
      await audit(db, u, 'article.updated', id);
      return a;
    });
  }
  @Post('jobs/:id/retry') async retry(@Req() req: Authed, @Param('id') id: string) {
    const u = user(req, ['admin']);
    return tx(async (db) => {
      const [job] = await q(
        "UPDATE jobs SET status='pending',next_run=now(),error=NULL WHERE id=$1 AND status='failed' RETURNING id",
        [z.coerce.number().int().positive().parse(id)],
        db,
      );
      if (!job) throw new ConflictException('To zadanie nie wymaga ponowienia.');
      await audit(db, u, 'job.retry', id);
      return job;
    });
  }
}
