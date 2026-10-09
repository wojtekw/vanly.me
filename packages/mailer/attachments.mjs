import crypto from 'node:crypto';
import { MailerError } from './errors.mjs';

// Keep below SES's 40 MB limit and common mailbox limits, accounting for MIME encoding.
export const MAX_ENCODED_MAIL_BYTES = 10 * 1024 * 1024;
export function validateAttachments(input = []) {
  if (!Array.isArray(input) || input.length > 5 || new Set(input.map((item) => item?.documentId)).size !== input.length)
    throw new MailerError('MAIL_ATTACHMENTS_INVALID');
  return input.map((item) => {
    if (!item || typeof item.fileName !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,175}\.pdf$/.test(item.fileName) ||
        item.contentType !== 'application/pdf' || !Buffer.isBuffer(item.data) || !item.data.length ||
        item.data.length > 5 * 1024 * 1024 || item.data.subarray(0, 5).toString('ascii') !== '%PDF-' ||
        !['summary', 'amendment', 'pickup', 'return'].includes(item.kind) ||
        !Number.isSafeInteger(item.version) || item.version < 1 ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.documentId || '') ||
        crypto.createHash('sha256').update(item.data).digest('hex') !== item.sha256)
      throw new MailerError('MAIL_ATTACHMENT_INVALID');
    return { documentId: item.documentId, fileName: item.fileName, contentType: item.contentType,
      data: item.data, sha256: item.sha256, kind: item.kind, version: item.version, size: item.data.length,
      bookingReference: item.bookingReference, bookingStatus: item.bookingStatus, amendmentId: item.amendmentId };
  });
}

export function validateEncodedMessageSize(message) {
  // UTF-8 text can require three bytes of quoted-printable per original byte.
  let size = Buffer.byteLength(message.subject + message.html + message.text) * 3 + 16384;
  for (const item of message.attachments || []) {
    const base64Size = Math.ceil(item.data.length / 3) * 4;
    size += base64Size + Math.ceil(base64Size / 76) * 2 + 16384;
  }
  if (size > MAX_ENCODED_MAIL_BYTES) throw new MailerError('MAIL_ENCODED_MESSAGE_TOO_LARGE');
  return size;
}

export function attachmentMetadata(attachments) {
  return attachments.map(({ documentId, fileName, contentType, sha256, kind, version, size }) =>
    ({ documentId, fileName, contentType, sha256, kind, version, size }));
}
