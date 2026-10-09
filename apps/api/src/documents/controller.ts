import { Controller, Get, Param, Req, Res, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { pool } from '../db';
import { user, type Authed } from '../auth';
import { listBookingDocuments, loadBookingDocument } from './service';

function translate(error: unknown): never {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'DOCUMENT_NOT_FOUND')
    throw new NotFoundException('Nie znaleziono dokumentu.');
  throw new InternalServerErrorException('Nie można teraz udostępnić dokumentu.');
}

@Controller('api/v1/bookings')
export class DocumentController {
  @Get(':id/documents')
  async list(@Req() req: Authed, @Param('id') id: string, @Res({ passthrough: true }) res: FastifyReply) {
    const actor = user(req);
    z.uuid().parse(id);
    res.header('Cache-Control', 'private, no-store');
    try { return await listBookingDocuments(pool, id, actor); } catch (error) { translate(error); }
  }

  @Get(':id/documents/:documentId')
  async download(@Req() req: Authed, @Param('id') id: string, @Param('documentId') documentId: string, @Res() res: FastifyReply) {
    const actor = user(req);
    z.uuid().parse(id); z.uuid().parse(documentId);
    try {
      const document = await loadBookingDocument(pool, id, documentId, actor);
      res.header('Content-Type', 'application/pdf');
      res.header('Content-Disposition', `attachment; filename="${document.fileName}"`);
      res.header('Cache-Control', 'private, no-store');
      res.header('X-Content-Type-Options', 'nosniff');
      return res.send(document.data);
    } catch (error) { translate(error); }
  }
}
