import crypto from 'node:crypto';
import { bookingDocumentSnapshot, documentKinds, uuid } from './model.mjs';
import { renderBookingPdf } from './pdf.mjs';
import { DocumentError } from './errors.mjs';

const hash = (data) => crypto.createHash('sha256').update(data).digest('hex');
const names = { summary: 'podsumowanie', amendment: 'zaakceptowana-zmiana', pickup: 'protokol-odbioru', return: 'protokol-zwrotu' };

function metadata(row) {
  return { documentId: row.id, fileName: row.file_name, kind: row.kind, version: row.version,
    contentType: row.content_type, size: row.size ?? row.content?.length, sha256: row.sha256, createdAt: row.created_at };
}

// Called with the same PoolClient/transaction as the domain event and mail outbox.
// No cloud, filesystem, or network side effects are performed in this transaction.
export async function createBookingDocuments(db, bookingId, options = {}) {
  const kind = options.kind || 'summary';
  if (!uuid.test(bookingId) || !documentKinds.includes(kind) ||
      typeof options.eventKey !== 'string' || options.eventKey.length < 1 || options.eventKey.length > 256)
    throw new DocumentError('DOCUMENT_INVALID_REQUEST');
  if (kind !== 'summary' && !uuid.test(options.sourceId || ''))
    throw new DocumentError('DOCUMENT_SOURCE_ID_REQUIRED');
  // The caller normally already locks the booking. This also serializes version numbers.
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['documents:' + bookingId]);
  const existing = await db.query('SELECT id,kind FROM booking_documents WHERE booking_id=$1 AND event_key=$2', [bookingId, options.eventKey]);
  if (existing.rows.length) {
    if (existing.rows[0].kind !== kind) throw new DocumentError('DOCUMENT_EVENT_KIND_MISMATCH');
    return [{ documentId: existing.rows[0].id }];
  }
  const result = await db.query(
    `SELECT b.*,EXISTS(SELECT 1 FROM payments p WHERE p.booking_id=b.id AND p.provider='local_test') AS has_test_payments
     FROM bookings b WHERE b.id=$1`, [bookingId]);
  const booking = result.rows[0];
  if (!booking) throw new DocumentError('DOCUMENT_BOOKING_NOT_FOUND');
  const details = { kind, recordedAt: options.recordedAt || new Date() };
  if (kind === 'amendment') details.amendment = (await db.query('SELECT * FROM amendments WHERE id=$1 AND booking_id=$2', [options.sourceId, bookingId])).rows[0];
  if (['pickup', 'return'].includes(kind)) details.handover = (await db.query('SELECT * FROM handovers WHERE id=$1 AND booking_id=$2', [options.sourceId, bookingId])).rows[0];
  const snapshot = bookingDocumentSnapshot(booking, details);
  const version = (await db.query('SELECT COALESCE(max(version),0)+1 AS version FROM booking_documents WHERE booking_id=$1 AND kind=$2', [bookingId, kind])).rows[0].version;
  const data = await renderBookingPdf(snapshot, { version });
  const reference = snapshot.reference.replace(/[^A-Za-z0-9-]/g, '').slice(0, 40) || 'VANLY';
  const filename = `VANLY-${reference}-${names[kind]}-v${version}.pdf`;
  const saved = await db.query(
    `INSERT INTO booking_documents(booking_id,kind,version,event_key,file_name,content,sha256,snapshot)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [bookingId, kind, version, options.eventKey, filename, data, hash(data), JSON.stringify(snapshot)]);
  return [{ documentId: saved.rows[0].id }];
}

function permitted(user, booking) {
  return user && (user.role === 'admin' || user.id === booking.user_id ||
    (user.role === 'owner' && user.company_id === booking.company_id));
}

export async function listBookingDocuments(db, bookingId, user) {
  if (!uuid.test(bookingId)) throw new DocumentError('DOCUMENT_NOT_FOUND');
  const booking = (await db.query('SELECT id,user_id,company_id FROM bookings WHERE id=$1', [bookingId])).rows[0];
  if (!booking || !permitted(user, booking)) throw new DocumentError('DOCUMENT_NOT_FOUND');
  const result = await db.query(
    `SELECT id,file_name,kind,version,content_type,octet_length(content) size,sha256,created_at
     FROM booking_documents WHERE booking_id=$1 ORDER BY created_at DESC,kind,version DESC`, [bookingId]);
  return result.rows.map(metadata);
}

export async function loadBookingDocument(db, bookingId, documentId, user) {
  if (!uuid.test(bookingId) || !uuid.test(documentId)) throw new DocumentError('DOCUMENT_NOT_FOUND');
  const row = (await db.query(
    `SELECT d.*,b.user_id,b.company_id FROM booking_documents d JOIN bookings b ON b.id=d.booking_id
     WHERE d.id=$1 AND d.booking_id=$2`, [documentId, bookingId])).rows[0];
  if (!row || !permitted(user, row)) throw new DocumentError('DOCUMENT_NOT_FOUND');
  if (!Buffer.isBuffer(row.content) || hash(row.content) !== row.sha256) throw new DocumentError('DOCUMENT_INTEGRITY_FAILED');
  return { ...metadata(row), data: row.content, bookingId: row.booking_id,
    bookingReference: row.snapshot.reference, bookingStatus: row.snapshot.bookingStatus,
    amendmentId: row.snapshot.amendment?.id };
}

export async function resolveMailDocuments(db, refs, job) {
  if (!Array.isArray(refs) || refs.length > 5 || refs.some((ref) =>
    !ref || Object.keys(ref).length !== 1 || !uuid.test(ref.documentId || '')) ||
    new Set(refs.map((ref) => ref.documentId)).size !== refs.length)
    throw new DocumentError('MAIL_DOCUMENT_REFS_INVALID');
  const user = (await db.query('SELECT id,role,company_id FROM users WHERE id=$1', [job.recipient_user_id])).rows[0];
  if (!user) throw new DocumentError('MAIL_DOCUMENT_RECIPIENT_UNAVAILABLE');
  const attachments = [];
  for (const ref of refs) {
    const found = (await db.query('SELECT booking_id FROM booking_documents WHERE id=$1', [ref.documentId])).rows[0];
    if (!found) throw new DocumentError('DOCUMENT_NOT_FOUND');
    attachments.push(await loadBookingDocument(db, found.booking_id, ref.documentId, user));
  }
  return attachments;
}

export async function renderPDFsForBooking(db, bookingId, options = {}) {
  const refs = await createBookingDocuments(db, bookingId, options);
  const row = (await db.query('SELECT user_id FROM bookings WHERE id=$1', [bookingId])).rows[0];
  return resolveMailDocuments(db, refs, { recipient_user_id: row.user_id });
}
