import { publicListing } from './publication';
import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Req,
  Res,
  BadRequestException,
  NotFoundException,
  ConflictException,
  PayloadTooLargeException,
} from '@nestjs/common';

import { FastifyReply as Response } from 'fastify';
import { createReadStream } from 'node:fs';
import { z } from 'zod';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Authed, user, companyScope } from './auth';
import { q, pool, tx, audit } from './db';
import { accessibleBooking } from './bookings';
const directory = () => process.env.UPLOAD_DIR || path.resolve(process.cwd(), '.local/uploads');
async function imageBuffer(req: Authed, limitMb: number) {
  const maxBytes = limitMb * 1024 * 1024;
  try {
    const part = await req.file({ limits: { fileSize: maxBytes }, throwFileSizeLimit: true });
    if (!part || part.fieldname !== 'file') throw new BadRequestException('Wybierz plik zdjęcia.');
    const buffer = await part.toBuffer();
    // Multipart can mark the stream truncated after yielding its final chunk.
    // Check the completed stream before attempting image decoding as well.
    if (part.file.truncated || buffer.byteLength > maxBytes)
      throw new PayloadTooLargeException(`Zdjęcie może mieć maksymalnie ${limitMb} MB.`);
    return buffer;
  } catch (error: any) {
    if (error.code === 'FST_REQ_FILE_TOO_LARGE')
      throw new PayloadTooLargeException(`Zdjęcie może mieć maksymalnie ${limitMb} MB.`);
    throw error;
  }
}
@Controller('api/v1')
export class MediaController {
  @Post('owner/vehicles/:id/photo')
  async upload(@Req() req: Authed, @Param('id') id: string) {
    const u = user(req, ['owner']);
    const [v] = await q('SELECT * FROM vehicles WHERE id=$1', [id]);
    if (!v) throw new NotFoundException();
    companyScope(u, v.company_id);
    const buffer = await imageBuffer(req, 5);
    let encoded: Buffer;
    try {
      encoded = await sharp(buffer, { limitInputPixels: 25000000 })
        .rotate()
        .resize({ width: 1800, withoutEnlargement: true })
        .webp({ quality: 88 })
        .toBuffer();
    } catch {
      throw new BadRequestException('Plik nie jest obsługiwanym obrazem.');
    }
    const mediaId = crypto.randomUUID(),
      filename = mediaId + '.webp';
    await fs.mkdir(directory(), { recursive: true });
    let fileWritten = false;
    try {
      return await tx(async (db) => {
        const [locked] = await q<{ company_id: string }>(
          'SELECT company_id FROM vehicles WHERE id=$1 FOR UPDATE',
          [id],
          db,
        );
        if (!locked) throw new NotFoundException();
        companyScope(u, locked.company_id);
        await fs.writeFile(path.join(directory(), filename), encoded, { mode: 0o600 });
        fileWritten = true;
        await q(
          'INSERT INTO media(id,company_id,vehicle_id,filename,public,created_by) VALUES($1,$2,$3,$4,true,$5)',
          [mediaId, locked.company_id, id, filename, u.id],
          db,
        );
        await q('UPDATE vehicles SET asset=$1 WHERE id=$2', ['/api/v1/media/' + mediaId, id], db);
        await audit(db, u, 'vehicle.photo_uploaded', id);
        return { asset: '/api/v1/media/' + mediaId };
      });
    } catch (error) {
      if (fileWritten) await fs.unlink(path.join(directory(), filename)).catch(() => undefined);
      throw error;
    }
  }
  @Post('owner/stock/:id/photos')
  async uploadStockPhoto(@Req() req: Authed, @Param('id') id: string) {
    const u = user(req, ['owner']);
    const [item] = await q('SELECT id FROM stock_items WHERE company_id=$1 AND id=$2', [
      u.company_id,
      id,
    ]);
    if (!item) throw new NotFoundException();
    const buffer = await imageBuffer(req, 10);
    let encoded: Buffer;
    try {
      const image = sharp(buffer, { limitInputPixels: 25000000 });
      const metadata = await image.metadata();
      if (!['jpeg', 'png', 'webp'].includes(metadata.format || ''))
        throw new Error('Unsupported image format');
      encoded = await image
        .rotate()
        .resize({ width: 1800, withoutEnlargement: true })
        .webp({ quality: 88 })
        .toBuffer();
    } catch {
      throw new BadRequestException('Wybierz obsługiwane zdjęcie JPG, PNG lub WebP.');
    }
    const mediaId = crypto.randomUUID(),
      filename = mediaId + '.webp';
    await fs.mkdir(directory(), { recursive: true });
    let fileWritten = false;
    try {
      return await tx(async (db) => {
        // Stock edits, uploads and removals share the item lock, including the six-photo limit.
        const [locked] = await q(
          'SELECT id FROM stock_items WHERE company_id=$1 AND id=$2 FOR UPDATE',
          [u.company_id, id],
          db,
        );
        if (!locked) throw new NotFoundException();
        const [free] = await q(
          `SELECT position FROM generate_series(1,6) AS slots(position) WHERE NOT EXISTS(
            SELECT 1 FROM stock_item_photos sp WHERE sp.company_id=$1 AND sp.item_id=$2 AND sp.position=slots.position
          ) ORDER BY position LIMIT 1`,
          [u.company_id, id],
          db,
        );
        if (!free) throw new ConflictException('Możesz dodać maksymalnie 6 zdjęć wyposażenia.');
        await fs.writeFile(path.join(directory(), filename), encoded, { mode: 0o600 });
        fileWritten = true;
        // Equipment photos, like vehicle photos, describe the offered product and are public.
        await q(
          'INSERT INTO media(id,company_id,filename,public,created_by) VALUES($1,$2,$3,true,$4)',
          [mediaId, u.company_id, filename, u.id],
          db,
        );
        await q(
          'INSERT INTO stock_item_photos(company_id,item_id,media_id,position,created_at) VALUES($1,$2,$3,$4,clock_timestamp())',
          [u.company_id, id, mediaId, free.position],
          db,
        );
        await audit(db, u, 'stock.photo_uploaded', id, { photoId: mediaId });
        return { id: mediaId, asset: '/api/v1/media/' + mediaId };
      });
    } catch (error) {
      if (fileWritten) await fs.unlink(path.join(directory(), filename)).catch(() => undefined);
      throw error;
    }
  }
  @Delete('owner/stock/:id/photos/:photoId')
  async deleteStockPhoto(
    @Req() req: Authed,
    @Param('id') id: string,
    @Param('photoId') photoId: string,
  ) {
    const u = user(req, ['owner']),
      parsedPhotoId = z.uuid().parse(photoId);
    const removed = await tx(async (db) => {
      const [item] = await q(
        'SELECT id FROM stock_items WHERE company_id=$1 AND id=$2 FOR UPDATE',
        [u.company_id, id],
        db,
      );
      if (!item) throw new NotFoundException();
      const [media] = await q(
        `DELETE FROM media m WHERE m.company_id=$1 AND m.id=$3 AND EXISTS(
          SELECT 1 FROM stock_item_photos sp WHERE sp.company_id=$1 AND sp.item_id=$2 AND sp.media_id=m.id
        ) RETURNING m.filename`,
        [u.company_id, id, parsedPhotoId],
        db,
      );
      if (!media) {
        const [existing] = await q('SELECT 1 FROM media WHERE id=$1', [parsedPhotoId], db);
        if (existing) throw new NotFoundException();
        return null;
      }
      await audit(db, u, 'stock.photo_deleted', id, { photoId: parsedPhotoId });
      return media;
    });
    if (removed) {
      await fs
        .unlink(path.join(directory(), removed.filename))
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT')
            console.error('Could not remove the deleted stock photo file.');
        });
    }
    return { ok: true };
  }
  @Get('media/:id') async serve(@Req() req: Authed, @Param('id') id: string, @Res() res: Response) {
    const [m] = await q('SELECT * FROM media WHERE id=$1', [z.uuid().parse(id)]);
    if (!m) throw new NotFoundException();
    let publicRead = m.public;
    if (m.public && m.vehicle_id) {
      const [vehicle] = await q(
        `SELECT v.status,c.verified,${publicListing()} publication_active FROM vehicles v
        JOIN companies c ON c.id=v.company_id WHERE v.id=$1`,
        [m.vehicle_id],
      );
      publicRead =
        vehicle?.status === 'published' && vehicle.verified && vehicle.publication_active;
      if (!publicRead) {
        const actor = req.user;
        const companyMember =
          actor?.role === 'admin' || (actor?.role === 'owner' && actor.company_id === m.company_id);
        const [booking] =
          actor && !companyMember
            ? await q(
                `SELECT 1 FROM bookings
          WHERE vehicle_id=$1 AND user_id=$2 AND status IN('pending','confirmed','in_rental','completed') LIMIT 1`,
                [m.vehicle_id, actor.id],
              )
            : [];
        if (!companyMember && !booking) throw new NotFoundException();
      }
    }
    if (!m.public) {
      const u = user(req);
      if (m.booking_id) await accessibleBooking(pool, u, m.booking_id);
      else companyScope(u, m.company_id);
    }
    res.type('image/webp');
    res.header('Cache-Control', publicRead ? 'public,max-age=3600' : 'private,no-store');
    if (path.basename(m.filename) !== m.filename) throw new NotFoundException();
    const location = path.join(directory(), m.filename);
    try {
      await fs.access(location);
    } catch {
      throw new NotFoundException();
    }
    res.send(createReadStream(location));
  }
}
