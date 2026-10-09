import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import dotenv from 'dotenv';
import { bookingDocumentSnapshot } from '../packages/documents/model.mjs';
import { renderBookingPdf } from '../packages/documents/pdf.mjs';
import { createBookingDocuments, loadBookingDocument, listBookingDocuments, resolveMailDocuments } from '../packages/documents/service.mjs';
import { booking, amendment, amendedBooking, handover } from './documents-fixture.mjs';
import { createLocalProvider } from '../packages/mailer/providers/local.mjs';
import { renderMail } from '../packages/mailer/renderer.mjs';
import { loadMailerConfig } from '../packages/mailer/config.mjs';

test('PDF snapshot preserves grossz, original pickup/company settings, and separate deposit', async () => {
  const b = booking();
  const model = bookingDocumentSnapshot(b, { recordedAt: '2026-10-07T12:00:00Z' });
  assert.equal(model.totalMinor, 410000); assert.equal(model.balanceMinor, 287000); assert.equal(model.depositMinor, 400000);
  assert.equal(model.pickupLocation, 'Gdańsk, Żeglarska 12'); assert.equal(model.companyName, 'Bałtyk Campers');
  assert.equal(model.companySettings.open, '09:00'); assert.equal(model.travelerName, 'Anna Kowalska');
  assert.ok(!JSON.stringify(model).includes('anna@example.com')); assert.ok(!JSON.stringify(model).includes('prywatnej wiadomości'));
  const data = await renderBookingPdf(model);
  assert.equal(data.subarray(0, 5).toString(), '%PDF-'); assert.ok(data.length > 10000); assert.ok(data.length < 300000);
  assert.throws(() => bookingDocumentSnapshot({ ...b, total_minor: 410000.5 }), /INVALID_INTEGER/);
  assert.throws(() => bookingDocumentSnapshot({ ...b, snapshot: { ...b.snapshot, prepMinor: 19000 } }), /BREAKDOWN_MISMATCH/);
  assert.throws(() => bookingDocumentSnapshot({ ...b, start_date: '2026-11-16' }), /QUOTE_MISMATCH/);
});

test('amendment/protocol documents follow persisted acceptance, do not invent signatures', async () => {
  assert.throws(() => bookingDocumentSnapshot(booking(), { kind: 'amendment', amendment: { ...amendment(), status: 'pending' } }), /NOT_ACCEPTED/);
  const model = bookingDocumentSnapshot(amendedBooking(), { kind: 'amendment', amendment: amendment() });
  assert.equal(model.amendment.previousTotalMinor, 410000); assert.equal(model.totalMinor, 466000); assert.equal(model.balanceMinor, 343000);
  const protocol = bookingDocumentSnapshot(booking(), { kind: 'pickup', handover: handover() });
  assert.equal(protocol.handover.confirmed, false); assert.equal(protocol.handover.mileage, 48720);
  assert.equal(Object.hasOwn(protocol.handover, 'signature'), false);
  for (const m of [model, protocol, bookingDocumentSnapshot(booking(), { kind: 'return', handover: handover('return', true) })])
    assert.equal((await renderBookingPdf(m)).subarray(0, 5).toString(), '%PDF-');
});

test('private documents are immutable, versioned, correctly scoped, and local mail stores only refs', async (t) => {
  dotenv.config({ path: '.env.local', quiet: true });
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString || new URL(connectionString).pathname !== '/vanly_test') throw new Error('Only vanly_test is allowed');
  pg.types.setTypeParser(1082, (s) => s);
  const pool = new pg.Pool({ connectionString });
  const db = await pool.connect();
  const schema = 'document_test_' + crypto.randomBytes(8).toString('hex');
  await db.query(`CREATE SCHEMA ${schema}`); await db.query(`SET search_path TO ${schema},public`);
  try {
    await db.query(`
      CREATE TABLE users(id uuid PRIMARY KEY,role text,company_id text);
      CREATE TABLE bookings(id uuid PRIMARY KEY,user_id uuid,company_id text,vehicle_id text,reference text,
        start_date date,end_date date,guests int,status text,payment_status text,deposit_status text,
        total_minor int,paid_minor int,deposit_minor int,snapshot jsonb,traveler jsonb);
      CREATE TABLE payments(booking_id uuid,provider text);
      CREATE TABLE amendments(id uuid,booking_id uuid,status text,previous jsonb,input jsonb,created_at timestamptz);
      CREATE TABLE handovers(id uuid,booking_id uuid,kind text,mileage int,fuel text,notes text,checks jsonb,confirmed boolean,created_at timestamptz);
      CREATE TABLE local_mail(id bigserial PRIMARY KEY,user_id uuid,subject text,body text,html text,text_body text,template_id text,job_id bigint);
      CREATE UNIQUE INDEX local_mail_job ON local_mail(job_id) WHERE job_id IS NOT NULL;`);
    await db.query(fs.readFileSync(path.resolve('db/migrations/013_booking_documents.sql'), 'utf8'));
    const b = booking();
    await db.query('INSERT INTO users(id,role,company_id) VALUES($1,$2,$3)', [b.user_id, 'traveler', null]);
    await db.query('INSERT INTO users(id,role,company_id) VALUES($1,$2,$3)', ['22222222-2222-4222-8222-222222222222', 'owner', 'baltyk-campers']);
    const keys = ['id', 'user_id', 'company_id', 'vehicle_id', 'reference', 'start_date', 'end_date', 'guests', 'status', 'payment_status', 'deposit_status', 'total_minor', 'paid_minor', 'deposit_minor', 'snapshot', 'traveler'];
    await db.query(`INSERT INTO bookings(${keys.join(',')}) VALUES(${keys.map((_, i) => '$' + (i + 1)).join(',')})`, keys.map((key) => typeof b[key] === 'object' ? JSON.stringify(b[key]) : b[key]));
    const actor = { id: b.user_id, role: 'traveler' };
    let refs;
    await t.test('document creation is transactional and duplicate events keep exact original bytes', async () => {
      await db.query('BEGIN');
      refs = await createBookingDocuments(db, b.id, { kind: 'summary', eventKey: 'booking.confirmed:' + b.id });
      await db.query('COMMIT');
      const original = await loadBookingDocument(db, b.id, refs[0].documentId, actor);
      assert.deepEqual(await createBookingDocuments(db, b.id, { kind: 'summary', eventKey: 'booking.confirmed:' + b.id }), refs);
      await db.query(`UPDATE bookings SET snapshot=jsonb_set(snapshot,'{vehicle,company_name}','"Nowa nazwa firmy"') WHERE id=$1`, [b.id]);
      const preserved = await loadBookingDocument(db, b.id, refs[0].documentId, actor);
      assert.deepEqual(preserved.data, original.data); assert.equal(preserved.version, 1);
      const oldSnapshot = (await db.query('SELECT snapshot FROM booking_documents WHERE id=$1', [refs[0].documentId])).rows[0].snapshot;
      assert.equal(oldSnapshot.companyName, 'Bałtyk Campers');
      await assert.rejects(db.query(`UPDATE booking_documents SET file_name='changed.pdf' WHERE id=$1`, [refs[0].documentId]), /immutable/);
      await db.query('BEGIN');
      const next = await createBookingDocuments(db, b.id, { kind: 'summary', eventKey: 'summary.refresh:' + b.id });
      await db.query('COMMIT');
      assert.equal((await loadBookingDocument(db, b.id, next[0].documentId, actor)).version, 2);
    });
    await t.test('booking owner, traveler, and admin have access; unrelated traveler/company do not', async () => {
      for (const forbidden of [{ id: 'other', role: 'traveler' }, { id: 'other', role: 'owner', company_id: 'foreign-company' }]) {
        await assert.rejects(listBookingDocuments(db, b.id, forbidden), /NOT_FOUND/);
        await assert.rejects(loadBookingDocument(db, b.id, refs[0].documentId, forbidden), /NOT_FOUND/);
      }
      assert.equal((await listBookingDocuments(db, b.id, { id: 'owner', role: 'owner', company_id: b.company_id })).length, 2);
      assert.equal((await listBookingDocuments(db, b.id, { id: 'admin', role: 'admin' })).length, 2);
      await assert.rejects(resolveMailDocuments(db, [{ documentId: refs[0].documentId, path: '/private' }], { recipient_user_id: b.user_id }), /REFS_INVALID/);
    });
    await t.test('local email keeps safe attachment metadata and authenticated immutable document ref', async () => {
      const attachments = await resolveMailDocuments(db, refs, { recipient_user_id: b.user_id });
      const mail = renderMail({ subject: 'Rezerwacja potwierdzona', body: 'Podsumowanie w załączniku.' }, loadMailerConfig({}), {}, new Date(), attachments);
      const provider = createLocalProvider(db);
      await provider.send(mail, { id: 1, recipient_user_id: b.user_id });
      const saved = (await db.query('SELECT attachments FROM local_mail WHERE job_id=1')).rows[0].attachments;
      assert.equal(saved[0].documentId, refs[0].documentId); assert.equal(saved[0].contentType, 'application/pdf');
      assert.equal(saved[0].sha256, attachments[0].sha256); assert.equal(Object.hasOwn(saved[0], 'data'), false);
      assert.equal(Object.hasOwn(saved[0], 'path'), false); assert.ok(JSON.stringify(saved).length < 1000);
    });
  } finally {
    await db.query('ROLLBACK').catch(() => {}); await db.query(`DROP SCHEMA ${schema} CASCADE`);
    db.release(); await pool.end();
  }
});
