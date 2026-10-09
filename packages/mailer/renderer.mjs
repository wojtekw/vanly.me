import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MailerError } from './errors.mjs';
import { validateAttachments, validateEncodedMessageSize } from './attachments.mjs';
import { getMailSender } from './senders.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'templates');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const templates = new Map();
const tokens = (source) => [...source.matchAll(/\{\{([a-z_]+)\}\}/g)].map((match) => match[1]);
for (const entry of manifest.templates) {
  if (!/^[0-9]{2}-[a-z-]+$/.test(entry.id)) throw new MailerError('INVALID_TEMPLATE_MANIFEST');
  const assets = {};
  for (const [kind, filename] of Object.entries(entry.files)) {
    if (!/^[0-9]{2}-[a-z-]+\.(html|txt)$/.test(filename))
      throw new MailerError('INVALID_TEMPLATE_PATH');
    assets[kind] = fs.readFileSync(path.join(root, filename), 'utf8');
  }
  const actual = new Set(tokens(entry.subject + assets.html + assets.text_plain));
  if (
    [...actual].some((key) => !entry.placeholders.includes(key)) ||
    entry.placeholders.some((key) => !actual.has(key))
  )
    throw new MailerError('INVALID_TEMPLATE_PLACEHOLDERS');
  templates.set(entry.id, { ...entry, ...assets });
}

export function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char],
  );
}

export function safeActionUrl(value, appUrl, allowedOrigins = [new URL(appUrl).origin]) {
  let url;
  try {
    url = new URL(value, appUrl);
  } catch {
    throw new MailerError('INVALID_ACTION_URL');
  }
  if (
    !allowedOrigins.includes(url.origin) ||
    url.username ||
    url.password ||
    !['https:', 'http:'].includes(url.protocol)
  )
    throw new MailerError('UNTRUSTED_ACTION_URL');
  return url.href;
}

function plain(value, key) {
  if (
    !['string', 'number'].includes(typeof value) ||
    (typeof value === 'number' && !Number.isFinite(value))
  )
    throw new MailerError('INVALID_TEMPLATE_VALUE');
  const text = String(value);
  if (text.length > 20000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))
    throw new MailerError('INVALID_TEMPLATE_VALUE');
  if (key === 'email_subject' && (/[\r\n]/.test(text) || text.length > 200))
    throw new MailerError('INVALID_EMAIL_SUBJECT');
  return text;
}

export function renderMail(payload, config, recipient = {}, now = new Date(), resolvedAttachments = []) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new MailerError('INVALID_MAIL_PAYLOAD');
  const templateId = payload.template || '00-bazowy-transakcyjny';
  const template = templates.get(templateId);
  if (!template) throw new MailerError('UNKNOWN_MAIL_TEMPLATE');
  if (template.marketing) throw new MailerError('MARKETING_REQUIRES_SEPARATE_CONSENT_PIPELINE');
  const attachments = validateAttachments(resolvedAttachments);
  if (template.required_document_kinds?.some((kind) => !attachments.some((item) => item.kind === kind)))
    throw new MailerError('TEMPLATE_ATTACHMENTS_REQUIRED');
  const input = payload.variables ?? {};
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length > 80)
    throw new MailerError('INVALID_TEMPLATE_VARIABLES');
  const variables = Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, plain(value, key)]),
  );
  if (template.required_document_kinds?.length) {
    for (const kind of template.required_document_kinds) {
      const document = attachments.find((item) => item.kind === kind);
      if (variables.booking_number && document.bookingReference !== variables.booking_number)
        throw new MailerError('TEMPLATE_DOCUMENT_BOOKING_MISMATCH');
      if (['04-rezerwacja-potwierdzona', '13-potwierdzenie-i-platnosc'].includes(templateId) && document.bookingStatus !== 'confirmed')
        throw new MailerError('TEMPLATE_DOCUMENT_STATUS_MISMATCH');
      if (templateId === '06-zmiana-dat-z-doplata' && !document.amendmentId)
        throw new MailerError('TEMPLATE_DOCUMENT_AMENDMENT_REQUIRED');
    }
  }
  const legacyBody = payload.body === undefined ? null : plain(payload.body, 'body');
  if (templateId === '00-bazowy-transakcyjny') {
    if (!payload.subject || legacyBody === null)
      throw new MailerError('GENERIC_MAIL_SUBJECT_BODY_REQUIRED');
    Object.assign(variables, {
      email_subject: plain(payload.subject, 'email_subject'),
      email_heading: variables.email_heading || payload.subject,
      email_preheader: variables.email_preheader || legacyBody.replace(/\s+/g, ' ').slice(0, 140),
      message_category: variables.message_category || 'POWIADOMIENIE VANLY',
      intro_text: variables.intro_text || legacyBody,
      details_text: variables.details_text || '',
      next_step_text: variables.next_step_text || '',
      cta_label: variables.cta_label || 'Otwórz VANLY',
      action_url: variables.action_url || config.appUrl,
    });
  }
  Object.assign(variables, {
    app_url: config.appUrl,
    support_email: config.replyTo,
    sender_legal_name: config.legalName,
    sender_legal_address: config.legalAddress,
    sender_registration_details: config.registrationDetails,
    current_year: String(now.getUTCFullYear()),
    display_timezone: 'Europe/Warsaw',
    first_name: variables.first_name || recipient.name?.trim().split(/\s+/)[0] || 'Podróżniku',
    attachment_names: attachments.map((item) => item.fileName).join(', '),
  });
  for (const key of template.placeholders) {
    if (!Object.hasOwn(variables, key)) throw new MailerError('MISSING_TEMPLATE_VALUE');
    variables[key] = plain(variables[key], key);
    if (key.endsWith('_url'))
      variables[key] = safeActionUrl(variables[key], config.appUrl, config.allowedAppOrigins);
  }
  const substitute = (source, html = false) =>
    source.replace(/\{\{([a-z_]+)\}\}/g, (_, key) =>
      html ? escapeHtml(variables[key]).replace(/\r?\n/g, '<br>') : variables[key],
    );
  const subject = plain(substitute(template.subject), 'email_subject');
  let html = substitute(template.html, true);
  const text = substitute(template.text_plain);
  if (Buffer.byteLength(html + text) > 256000) throw new MailerError('MAIL_CONTENT_TOO_LARGE');
  const headers = [];
  if (payload.marketing) {
    if (payload.notificationGuard?.kind !== 'newsletter' ||
        typeof payload.marketing.campaignId !== 'string' ||
        payload.notificationGuard.campaignId !== payload.marketing.campaignId)
      throw new MailerError('MARKETING_GUARD_REQUIRED');
    for (const key of ['unsubscribeUrl', 'oneClickUnsubscribeUrl']) {
      if (typeof payload.marketing[key] !== 'string' || payload.marketing[key].length > 2000)
        throw new MailerError('MARKETING_UNSUBSCRIBE_URL_INVALID');
      const url = safeActionUrl(payload.marketing[key], config.appUrl, config.allowedAppOrigins);
      if (!url.startsWith('https://') || /[\r\n<>]/.test(url)) throw new MailerError('MARKETING_UNSUBSCRIBE_URL_INVALID');
    }
    headers.push({ Name: 'List-Unsubscribe', Value: `<${payload.marketing.oneClickUnsubscribeUrl}>` });
    headers.push({ Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' });
    const unsubscribeUrl = safeActionUrl(payload.marketing.unsubscribeUrl, config.appUrl, config.allowedAppOrigins);
    html = html.replace('</body>', `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F6F3EB;"><tr><td align="center" style="padding:14px 24px 24px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;"><a href="${escapeHtml(unsubscribeUrl)}" style="color:#174A36;text-decoration:underline;">Rezygnuję z inspiracji</a></td></tr></table></body>`);
  }
  const sender = getMailSender(config, payload.senderKind || 'portal');
  const message = { subject, html, text, legacyBody: legacyBody ?? text, templateId, attachments, headers, ...sender };
  validateEncodedMessageSize(message);
  return message;
}

export const templateCatalog = Object.freeze(
  manifest.templates.map(({ id, event, marketing, required_attachments }) => ({
    id,
    event,
    enabled: !marketing,
  })),
);
