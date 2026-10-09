# Prywatne dokumenty VANLY

Komponent tworzy podsumowanie rezerwacji, zaakceptowanej zmiany oraz protokoły odbioru i zwrotu. PDF powstaje z zapisanej wyceny i stanu rezerwacji w chwili zdarzenia. Ceny są zapisane w groszach, kaucja jest rozliczana osobno. Miejsce odbioru, nazwa firmy i ustawienia pochodzą z zachowanego snapshotu, a nie z aktualnej, możliwej do edycji oferty.

Nie zapisuje ani nie wymyśla regulaminu, numerów rejestrowych czy podpisów. Dokumenty opisują potwierdzenie w portalu i jawnie oznaczają płatności testowe.

`createBookingDocuments(db, bookingId, {kind, sourceId?, eventKey})` należy wywołać na `PoolClient` w tej samej transakcji, która zapisuje zdarzenie i wiadomość do kolejki. Dokument otrzymuje numer wersji, SHA-256 i zapisane bajty PDF. Ponowienie tego samego zdarzenia zwraca identyczny dokument; zmianę zapisuje się jako nową wersję. Migracja `013_booking_documents.sql` blokuje nadpisanie dokumentów.

Do zadania mailowego trafia tylko `documentRefs: [{documentId}]`. Worker odczytuje oryginalny PDF przez `resolveMailDocuments`, ponownie sprawdza aktualne uprawnienia odbiorcy i przekazuje binarne bajty do SES v2 `Simple.Attachments`. SDK koduje je na etapie przesyłania; `ContentTransferEncoding: BASE64` określa kodowanie załącznika w wiadomości MIME. Całość ma konserwatywny limit 10 MiB po uwzględnieniu kodowania MIME. Lokalna skrzynka przechowuje tylko metadane dokumentu, bez ścieżek i powielonych bajtów PDF.

Endpointy `GET /api/v1/bookings/:id/documents` i `GET /api/v1/bookings/:id/documents/:documentId` wymagają aktywnej sesji. Dokument jest dostępny podróżującemu, właścicielowi właściwej firmy i administratorowi. Nie korzysta z publicznego katalogu mediów; odpowiedzi mają `Cache-Control: private, no-store`.

Produkcja używa `pdfkit` i dołączonych fontów DejaVu Sans z pełną licencją w `fonts/LICENSE.txt`. Nie wymaga zewnętrznej usługi konwersji, Pythona, S3 ani udostępniania prywatnych danych publicznemu URL.

Testy: `node --test tests/documents.test.mjs tests/mailer-attachments.test.mjs`. Testy bazy tworzą i usuwają wyłącznie własny schemat w `vanly_test`.

Dokumentacja API załączników: https://docs.aws.amazon.com/ses/latest/dg/attachments.html
