import { enqueueMail, MailOptions, NotificationDb } from './queue';
import { allowedAppOrigins } from '../request-origin';

export function notificationUrl(path: string, requestedOrigin?: string) {
  const defaultOrigin = process.env.APP_URL || process.env.APP_ORIGIN || 'http://localhost:3100';
  if (requestedOrigin && ![defaultOrigin, ...allowedAppOrigins()].includes(requestedOrigin))
    throw new Error('Nieprawidłowe źródło powiadomienia.');
  const origin = requestedOrigin || defaultOrigin;
  const base = new URL(origin);
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password)
    throw new Error('Nieprawidłowy adres serwisu dla powiadomień.');
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Nieprawidłowa ścieżka.');
  return new URL(path, base).href;
}

export const money = (minor: number) =>
  new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(minor / 100);
export function date(value: string) {
  return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'long', timeZone: 'Europe/Warsaw' }).format(
    new Date(value.slice(0, 10) + 'T12:00:00Z'),
  );
}

type StatusNotice = {
  userId: string;
  eventKey: string;
  subject: string;
  category: string;
  intro: string;
  details: string;
  nextStep: string;
  cta: string;
  path: string;
  firstName?: string;
  expiresAt?: string;
  documentRefs?: { documentId: string }[];
  senderKind?: 'no-reply' | 'portal';
};
export async function notifyStatus(db: NotificationDb, notice: StatusNotice) {
  const actionUrl = notificationUrl(notice.path);
  const variables: NonNullable<MailOptions['variables']> = {
    email_subject: notice.subject,
    email_preheader: notice.intro,
    email_heading: notice.subject,
    message_category: notice.category,
    intro_text: notice.intro,
    details_text: notice.details,
    next_step_text: notice.nextStep,
    cta_label: notice.cta,
    action_url: actionUrl,
  };
  if (notice.firstName) variables.first_name = notice.firstName;
  return enqueueMail(
    db,
    notice.userId,
    notice.subject,
    [notice.intro, notice.details, notice.nextStep, actionUrl].filter(Boolean).join('\n\n'),
    {
      eventKey: notice.eventKey,
      template: '00-bazowy-transakcyjny',
      variables,
      expiresAt: notice.expiresAt,
      documentRefs: notice.documentRefs,
      senderKind: notice.senderKind,
    },
  );
}
