import PDFDocument from 'pdfkit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DocumentError } from './errors.mjs';

const fonts = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fonts');
const money = (value) =>
  new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(value / 100);
const date = (value) =>
  new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Warsaw',
  }).format(new Date(value + 'T12:00:00Z'));
const timestamp = (value) =>
  new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Warsaw',
  }).format(new Date(value));
const bookingStatus = {
  held: 'Niepotwierdzona',
  pending: 'Niepotwierdzona',
  confirmed: 'Potwierdzona',
  in_rental: 'Potwierdzona',
  completed: 'Potwierdzona',
  cancelled: 'Anulowana',
  rejected: 'Odrzucona',
  expired: 'Anulowana',
};
const paymentStatus = {
  unpaid: 'Nieopłacona',
  partial: 'Częściowo opłacona',
  paid: 'Cena najmu opłacona',
  refund_pending: 'Rozliczenie oczekuje na zwrot',
  refunded: 'Zwrot zapisany',
};
const depositStatus = {
  scheduled: 'Do wniesienia',
  authorized: 'Wniesienie / autoryzacja zapisana przez firmę',
  released: 'Zwolnienie zapisane przez firmę',
  claim_pending: 'Oczekuje na wyjaśnienie roszczenia',
};
const titles = {
  summary: 'Podsumowanie rezerwacji',
  amendment: 'Podsumowanie zaakceptowanej zmiany',
  pickup: 'Protokół odbioru pojazdu',
  return: 'Protokół zwrotu pojazdu',
};

export async function renderBookingPdf(model, { version = 1 } = {}) {
  if (!titles[model.kind] || !Number.isSafeInteger(version) || version < 1)
    throw new DocumentError('DOCUMENT_INVALID_RENDER_INPUT');
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 48, bottom: 65, left: 48, right: 48 },
    bufferPages: true,
    info: {
      Title: `${titles[model.kind]} ${model.reference}`,
      Author: 'VANLY',
      Subject: 'Zapis danych rezerwacji w VANLY',
      CreationDate: new Date(model.recordedAt),
    },
  });
  doc.registerFont('Regular', path.join(fonts, 'DejaVuSans.ttf'));
  doc.registerFont('Bold', path.join(fonts, 'DejaVuSans-Bold.ttf'));
  const chunks = [];
  const completion = new Promise((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const width = doc.page.width - 96;
  const green = '#174A36',
    ink = '#20372D',
    muted = '#65766B';
  const ensure = (height) => {
    if (doc.y + height > doc.page.height - 82) {
      doc.addPage();
      return true;
    }
    return false;
  };
  const para = (value, { bold = false, size = 10, color = ink, gap = 8 } = {}) => {
    if (!value) return;
    doc
      .font(bold ? 'Bold' : 'Regular')
      .fontSize(size)
      .fillColor(color);
    // PDFKit paginates long paragraphs; a section heading is kept with its first line.
    ensure(Math.min(doc.heightOfString(value, { width, lineGap: 3 }), 45) + gap);
    doc.text(value, 48, doc.y, { width, lineGap: 3 });
    doc.moveDown(gap / (size * 1.2));
  };
  let activeSection = '';
  const section = (title) => {
    ensure(54);
    activeSection = title;
    doc.moveDown(0.5);
    para(title, { bold: true, size: 12, color: green, gap: 9 });
  };
  const row = (label, value, { strong = false } = {}) => {
    const leftWidth = 205,
      rightWidth = width - 219;
    doc.font('Regular').fontSize(10);
    const height =
      Math.max(
        doc.heightOfString(label, { width: leftWidth }),
        doc.heightOfString(String(value), { width: rightWidth }),
      ) + 13;
    if (ensure(height) && activeSection)
      para(`${activeSection} (ciąg dalszy)`, { bold: true, size: 12, color: green, gap: 9 });
    doc.font('Regular').fontSize(10);
    const y = doc.y;
    doc.fillColor(muted).font('Regular').text(label, 48, y, { width: leftWidth });
    doc
      .fillColor(ink)
      .font(strong ? 'Bold' : 'Regular')
      .text(String(value), 267, y, { width: rightWidth });
    doc
      .strokeColor('#DDE4DC')
      .lineWidth(0.5)
      .moveTo(48, y + height - 6)
      .lineTo(48 + width, y + height - 6)
      .stroke();
    doc.y = y + height;
  };
  para('VANLY', { bold: true, size: 23, color: green, gap: 16 });
  para(titles[model.kind], { bold: true, size: 19, color: green, gap: 8 });
  para(`${model.reference}  /  wersja ${version}`, { size: 10, color: muted, gap: 10 });
  para(
    `Zapis w portalu: ${timestamp(model.recordedAt)} (Europe/Warsaw). Dokument zachowuje dane z tej chwili. Aktualny stan znajdziesz na koncie VANLY.`,
    { size: 9, color: muted, gap: 14 },
  );
  if (model.testPayments)
    para(
      'SCENARIUSZ TESTOWY - wpłaty i zwroty w tej rezerwacji są lokalnymi zapisami testowymi. VANLY nie pobrało ani nie wypłaciło rzeczywistych pieniędzy.',
      { bold: true, size: 10, color: '#7C4E10', gap: 14 },
    );
  section('Twoja rezerwacja');
  row('Pojazd', model.vehicleName, { strong: true });
  row('Wypożyczalnia', model.companyName);
  if (model.travelerName) row('Podróżujący', model.travelerName);
  row('Odbiór', date(model.start));
  row('Zwrot', date(model.end));
  row('Doby / liczba osób', `${model.days} / ${model.guests}`);
  row(
    'Miejsce odbioru zapisane w wycenie',
    model.pickupLocation || 'Nie zostało zapisane - sprawdź z wypożyczalnią',
  );
  row('Status rezerwacji', bookingStatus[model.bookingStatus]);
  if (model.amendment) {
    section('Zaakceptowana zmiana');
    row(
      'Poprzedni termin',
      `${date(model.amendment.previousStart)} - ${date(model.amendment.previousEnd)}`,
    );
    row('Poprzednia cena', money(model.amendment.previousTotalMinor));
    const difference = model.totalMinor - model.amendment.previousTotalMinor;
    row('Zmiana ceny', `${difference < 0 ? '-' : '+'}${money(Math.abs(difference))}`);
    if (model.amendment.note)
      para(`Treść prośby podróżującego: ${model.amendment.note}`, { size: 9 });
    para(
      'Firma zaakceptowała zmianę w portalu. Ten zapis nie poświadcza podpisania aneksu ani umowy.',
      { size: 9, color: muted },
    );
  }
  section('Cena najmu i zapisane rozliczenie');
  row('Najem pojazdu', money(model.baseMinor));
  row('Przygotowanie', money(model.prepMinor));
  for (const e of model.extras)
    row(
      `${e.name} (${e.quantity} szt.)`,
      `${money(e.totalMinor)} (${money(e.priceMinor)} / ${e.unit === 'day' ? 'dobę' : 'wyjazd'})`,
    );
  row('Cena najmu łącznie', money(model.totalMinor), { strong: true });
  if (model.settlementMode === 'direct') {
    row('Rozliczenie najmu', 'Bezpośrednio z wypożyczalnią');
    row('Opłata za rezerwację w VANLY', money(0));
    para(
      'VANLY nie pobiera wpłat za najem ani kaucję. Kwoty, terminy i sposób zapłaty uzgodnij bezpośrednio z wypożyczalnią. Dokument nie potwierdza opłacenia najmu.',
      { size: 9, color: muted },
    );
  } else {
    row(
      'Wybrany plan',
      model.plan === 'deposit'
        ? '30% ceny przy rezerwacji, pozostała kwota później'
        : 'Cała cena przy rezerwacji',
    );
    row('Zapisane wpłaty netto', money(model.paidMinor));
    row('Pozostało do ceny najmu', money(model.balanceMinor));
    if (model.balanceMinor > 0 && model.balanceDue)
      row('Termin pozostałej płatności', date(model.balanceDue));
    if (model.overpaymentMinor > 0) row('Nadwyżka zapisanych wpłat', money(model.overpaymentMinor));
    row('Status rozliczenia', paymentStatus[model.paymentStatus]);
    if (model.paymentStatus === 'refund_pending')
      para(
        'Rozliczenie oczekuje na zwrot. Kwota i sposób zwrotu wymagają osobnego rozliczenia; dokument nie potwierdza wykonania przelewu.',
        { size: 9, color: muted },
      );
  }
  if (['cancelled', 'rejected', 'expired'].includes(model.bookingStatus))
    para(
      'Rezerwacja jest nieaktywna. Saldo względem zapisanej ceny ma charakter informacyjny i nie jest wezwaniem do dopłaty za anulowany wyjazd.',
      { size: 9, color: muted },
    );
  ensure(135);
  section('Kaucja - oddzielne rozliczenie');
  row('Kwota kaucji', money(model.depositMinor), { strong: true });
  row('Zapisany status kaucji', depositStatus[model.depositStatus]);
  para(
    'Kaucja nie wchodzi do ceny najmu. Status wskazuje zapis w VANLY; szczegóły wniesienia, rozliczenia i ewentualnych roszczeń uzgodnij z wypożyczalnią.',
    { size: 9, color: muted },
  );
  if (model.handover) {
    section(model.kind === 'pickup' ? 'Stan zapisany przy odbiorze' : 'Stan zapisany przy zwrocie');
    row('Przebieg', `${new Intl.NumberFormat('pl-PL').format(model.handover.mileage)} km`);
    row('Poziom paliwa', model.handover.fuel);
    row('Zapis protokołu', timestamp(model.handover.createdAt));
    for (const [key, label] of [
      ['equipment', 'Wyposażenie'],
      ['condition', 'Stan pojazdu'],
      ['fuel', 'Paliwo'],
    ])
      row(
        `Lista kontrolna: ${label}`,
        model.handover.checks[key]
          ? 'Sprawdzenie zapisane przez firmę'
          : 'Brak zapisanego sprawdzenia',
      );
    para(
      model.handover.notes ? `Uwagi firmy: ${model.handover.notes}` : 'Firma nie zapisała uwag.',
      { size: 10 },
    );
    para(
      model.handover.confirmed
        ? 'Podróżujący potwierdził protokół w portalu.'
        : 'Protokół oczekuje na potwierdzenie podróżującego w portalu.',
      { bold: true, size: 10 },
    );
    para(
      'Potwierdzenie w portalu nie jest kwalifikowanym podpisem elektronicznym. Dokument nie poświadcza podpisania odrębnej umowy.',
      { size: 9, color: muted },
    );
  }
  section('Ustawienia zapisane w wycenie');
  if (model.companySettings.minDays !== undefined)
    row('Minimalny najem w dniu wyceny', `${model.companySettings.minDays} doby`);
  if (model.companySettings.open || model.companySettings.close)
    row(
      'Godziny zapisane przez firmę',
      `${model.companySettings.open || '?'} - ${model.companySettings.close || '?'}`,
    );
  if (model.companySettings.cancellationSetting)
    row('Ustawienie anulowania z wyceny', model.companySettings.cancellationSetting);
  para(
    'To podsumowanie danych zapisanych w VANLY. Nie zastępuje regulaminu, umowy najmu ani dokumentu podpisanego przez strony. Portal nie zapisał tutaj zatwierdzonego tekstu umowy; zasady najmu i anulowania sprawdź z wypożyczalnią.',
    { size: 9, color: muted },
  );
  const pages = doc.bufferedPageRange();
  for (let i = pages.start; i < pages.start + pages.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // Footer sits outside the content margin without adding a page.
    doc.font('Regular').fontSize(8).fillColor(muted);
    doc.text(
      `${model.reference} | wersja ${version} | ${titles[model.kind]}`,
      48,
      doc.page.height - 42,
      { width: width - 85, lineBreak: false },
    );
    doc.text(`${i + 1} / ${pages.count}`, doc.page.width - 108, doc.page.height - 42, {
      width: 60,
      align: 'right',
      lineBreak: false,
    });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  const buffer = await completion;
  if (buffer.length > 5 * 1024 * 1024) throw new DocumentError('DOCUMENT_PDF_TOO_LARGE');
  return buffer;
}
