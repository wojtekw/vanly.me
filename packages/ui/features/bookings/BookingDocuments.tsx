'use client';
import { Download } from 'lucide-react';
import { useData, DataState } from '../../components/shared';

type BookingDocument = {
  documentId: string; fileName: string; kind: 'summary' | 'amendment' | 'pickup' | 'return';
  version: number; createdAt: string;
};
const titles = { summary: 'Podsumowanie rezerwacji', amendment: 'Zaakceptowana zmiana',
  pickup: 'Protokół odbioru', return: 'Protokół zwrotu' };
export const bookingDocumentUrl = (bookingId: string, documentId: string) =>
  '/api/v1/bookings/' + encodeURIComponent(bookingId) + '/documents/' + encodeURIComponent(documentId);

export function BookingDocuments({ bookingId }: { bookingId: string }) {
  const { data, error } = useData('/bookings/' + bookingId + '/documents');
  if (!error && !data?.length) return null;
  return (
    <section className="panel stack">
      <h2>Dokumenty rezerwacji</h2>
      <DataState data={data} error={error}>
        {data?.map((document: BookingDocument) => (
          <div className="spread" key={document.documentId}>
            <div>
              <strong>{titles[document.kind]}</strong>
              <p className="small muted">Wersja {document.version} · {new Date(document.createdAt).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })}</p>
            </div>
            <a className="btn secondary compact" href={bookingDocumentUrl(bookingId, document.documentId)} download={document.fileName}>
              Pobierz PDF <Download size={17} />
            </a>
          </div>
        ))}
      </DataState>
    </section>
  );
}
