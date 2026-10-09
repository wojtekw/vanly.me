# Rozliczenia na start — 9.10.2026

Podróżujący zatwierdza rezerwację bez wpłaty i bez opłaty platformy VANLY.
Cenę najmu, kaucję, terminy płatności i ewentualne zwroty rozlicza bezpośrednio
z wypożyczalnią według jej warunków. Cena najmu pozostaje w wycenie i dokumentach.
W VANLY stan `external` oznacza rozliczenie poza platformą, a nie opłacony najem.

Każda nowa rezerwacja wymaga decyzji wypożyczalni. Wysłanie przez podróżującego
zapisuje status **Niepotwierdzona**; dopiero właściciel właściwej firmy może ją
potwierdzić lub odrzucić. Podróżujący i operator nie mogą jej potwierdzić.
Niepotwierdzona rezerwacja blokuje termin; anulowanie lub odrzucenie go zwalnia.
Potwierdzenie tworzy podsumowanie PDF i powiadomienie, nigdy wpłatę w VANLY.

Status rezerwacji w interfejsie i polu API `reservation_status` ma cztery wartości:
`pending` (Niepotwierdzona), `cancelled` (Anulowana), `rejected` (Odrzucona)
i `confirmed` (Potwierdzona). Pole `status` zachowuje techniczny cykl blokady
i protokołów: `held` mapuje się na Niepotwierdzona, `expired` na Anulowana,
a `in_rental` i `completed` na Potwierdzona. Odbiór i zwrot są etapami najmu,
nie dodatkowymi statusami rezerwacji. Historyczne potwierdzenia pozostają ważne.
Migracja `016_owner_confirmation.sql` wyłącza dawne automatyczne potwierdzanie
na pojazdach; API ignoruje stare `instant=true` także w zachowanych wycenach.

Pierwszy dodany pojazd wypożyczalni jest bezpłatny bezterminowo. Każdy kolejny
kamper lub przyczepa kosztuje **1 Credit za miesiąc publikacji**. 1 Credit kosztuje
**200 zł** (20000 groszy). Szkice nie zużywają Creditsów. Portfel jest wspólny
dla firmy; 50 Creditsów zapewnia 50 miesięcy jednego płatnego pojazdu, 2 miesiące
25 płatnych pojazdów lub miesiąc 50 płatnych pojazdów. Bezpłatny pojazd jest dodatkowy.

API pobiera Credit w transakcji przy publikacji. Worker automatycznie odnawia
okres z portfela. Miesiąc oznacza kalendarzową rocznicę UTC: 31 stycznia → ostatni
dzień lutego → 31 marca, z zachowaniem godziny. Brak Creditsów ukrywa ofertę.
Wygasła oferta znika z katalogu i nowych wycen również przy niedostępnym workerze.
Rezerwacje, dokumenty i dotychczasowe rozmowy nadal można obsługiwać.

Zasilenie portfela wznawia automatycznie oferty wstrzymane z braku Creditsów.
Po przerwie opłacamy nowy miesiąc od wznowienia, bez pobierania Creditsów za
miesiące ukrycia. Ręczne ukrycie zatrzymuje odnowienia. Opłacony okres zostaje;
ponowna publikacja przed jego końcem nie pobiera kolejnego Credita.
Przy ograniczonym saldzie odnowienia idą według daty końca okresu, następnie ID.

Portfel i historia operacji są przypisane do uwierzytelnionej firmy. Zakup
przyjmuje wyłącznie całkowitą liczbę Creditsów (1–100000) i identyfikator operacji;
cenę wylicza serwer. Powtórzenie zakupu nie zasila portfela ponownie.
Blokada portfela serializuje zakup, publikację i odnowienia; saldo nie może być ujemne.

Migracja `017_credit_wallets.sql` zachowuje dawny rejestr jednorazowych opłat.
Najstarszy pojazd firmy otrzymuje bezpłatny slot. Pozostałe istniejące opublikowane
oferty dostają jeden miesiąc przejściowy; historia pokazuje grant i zużycie,
a saldo początkowe wynosi 0. Ukryte oferty i szkice nie dostają opłaconego okresu.
Nie naliczamy opłat wstecz. Dawny endpoint opłaty pojedynczego pojazdu zwraca 410.
Migrację wycofujemy przez przywrócenie chronionej kopii bazy wraz z poprzednią
wersją aplikacji; sam powrót obrazu nie usuwa nowych tabel i historii.

Na UAT zakup Creditsów jest wyłącznie symulacją `purchase_test` / `local_test`,
bez pobierania rzeczywistych pieniędzy. Integracja Autopay wymaga osobnego wdrożenia.
`LOCAL_PAYMENTS=false` blokuje zakup testowy, lecz nie obsługę istniejącego portfela.

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

Testy: `pnpm test:credits`, integracyjne testy API i rezerwacji, dokumentów,
powiadomień oraz interfejsu. Testy bazodanowe wymagają własnej bazy `vanly_test`.
Kod, sekrety, dane i pliki UAT są rozdzielone. Aktualizacja hosta nie odtwarza
ani nie zastępuje bazy danymi lokalnymi.
