# Rozliczenia na start — 9.10.2026

Podróżujący zatwierdza rezerwację bez wpłaty i bez opłaty platformy VANLY.
Cenę najmu, kaucję, terminy płatności i ewentualne zwroty rozlicza bezpośrednio
z wypożyczalnią według jej warunków. Cena najmu pozostaje w wycenie i dokumentach.
W VANLY stan `external` oznacza rozliczenie poza platformą, a nie opłacony najem.

Pierwszy pojazd wypożyczalni jest bezpłatny. Dodanie drugiego i każdego kolejnego
kosztuje **200 zł jednorazowo** (20000 groszy). Liczą się również szkice i ukryte
pojazdy. Opłatę tworzy API w tej samej transakcji co pojazd, po zablokowaniu firmy.
Edycja, ukrycie i ponowna publikacja nie naliczają kolejnej opłaty.

Pojazd z oczekującą opłatą pozostaje szkicem. W panelu floty wypożyczalnia
rozlicza opłatę, potem publikuje ofertę. Odrzucona płatność nie odblokowuje
publikacji. Ponowione żądanie utworzenia pojazdu lub rozliczenia nie powiela
pojazdu, opłaty ani zdarzenia w historii. Kwoty i firma są ustalane przez API.
Operator widzi rozliczenia w widoku wypożyczalni.

Na UAT płatność jest wyłącznie symulacją, oznaczoną `paid_test` / `local_test`.
Nie pobiera rzeczywistych pieniędzy. Połączenie z Autopay nadal wymaga osobnej
konfiguracji i integracji. `LOCAL_PAYMENTS=false` blokuje symulator.

Migracja `015_listing_billing.sql` zachowuje dotychczasowe rezerwacje, wpłaty
i dokumenty. Istniejąca flota otrzymuje zwolnienie `legacy`; opłaty nie są
naliczane wstecz. Stare rezerwacje zachowują dotychczasowe rozliczenia testowe.
Nowe mają `settlementMode=direct`, `dueNowMinor=0`, `balanceDue=null` i nie
otrzymują przypomnień o dopłacie w VANLY. Do zatwierdzenia służy
`POST /api/v1/bookings/:id/submit`.

Domyślny i wdrożony tryb to `TRAVELER_PAYMENT_MODE=direct`. Historyczny symulator
podróżującego jest dostępny wyłącznie przy jawnej konfiguracji
`TRAVELER_PAYMENT_MODE=local_test` i `LOCAL_PAYMENTS=true`; starsze testy regresji
używają go do sprawdzenia zapisanych wcześniej rozliczeń. Interfejs nowych
rezerwacji zawsze zatwierdza je bez wpłaty.

Testy: `pnpm test:billing`, integracyjne testy API i rezerwacji, dokumentów,
powiadomień oraz interfejsu. Testy bazodanowe wymagają własnej bazy `vanly_test`.
Kod, sekrety, dane i pliki UAT są rozdzielone. Aktualizacja hosta nie odtwarza
ani nie zastępuje bazy danymi lokalnymi.
