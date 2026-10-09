# Sprawdzenie instalacji Vanly — 23 września 2026

Adres: http://vanly.local. Projekt: `/Volumes/Extreme SSD/Vanly/Vanly.me`.

- Kompilacja Next.js i NestJS zakończona poprawnie.
- 14 testów integracyjnych API: wszystkie zaliczone. Sprawdzono uprawnienia i CSRF, kwoty z serwera, równoczesną rezerwację jednego pojazdu, blokadę bufora, wspólny magazyn z uwzględnieniem szczytowego wykorzystania, akceptację firmy, ponowienia wpłat i zwrotów, wygasanie blokad, zmianę terminu, protokoły, moderację opinii, weryfikację firmy, prywatność wiadomości i obsługę zdjęć.
- Pełna ścieżka w przeglądarce: wyszukanie → wyposażenie → blokada → płatność odrzucona → płatność udana → zmiana terminu → akceptacja → dopłata → odbiór → zwrot → opinia → moderacja. Zapisano i ponownie odczytano zmiany oferty.
- Widoki podróżnika, firmy i operatora sprawdzono przy szerokości 1440 px oraz mobilnej 390 px. Brak błędów JavaScript i poziomego przepełnienia dokumentu.
- Wgrywanie zdjęcia sprawdzono osobno przez rzeczywisty formularz i proxy, bez przechwytywania żądań przez test. Tymczasowy pojazd kontrolny i jego zdjęcie usunięto po sprawdzeniu.
- Pod adresem `vanly.local` sprawdzono stronę, ilustracje, API PostgreSQL oraz logowanie i wylogowanie z trzech typów kont.
- Usługi `local.vanly.api`, `local.vanly.web` i `local.vanly.worker` działają jako procesy użytkownika uruchamiane po zalogowaniu. `local.vanly.proxy` obsługuje osobny lokalny adres 127.0.0.2:80. Istniejący serwis Wydmuch nadal odpowiada na 127.0.0.1:80.
- Utworzono kopię bazy i plików oraz sprawdzono możliwość odczytu spisu kopii. Nie wykonano destrukcyjnego odtwarzania bazy użytkownika.
- Testy integracyjne i główna ścieżka przeglądarkowa korzystają z osobnej bazy `vanly_test`.

Płatności i kaucje są testowe; integracje zewnętrzne wymagają osobnego podłączenia. Nie utworzono zasobów AWS. Koszt AWS tej instalacji: 0 USD/miesiąc. Pełen zakres i ograniczenia opisuje README.md.

## Integracja kempingów Google — 23.09.2026

- Zbudowano Next.js i NestJS po zmianach, bez błędów TypeScript.
- Wszystkie 14 dotychczasowych testów API przeszło.
- Przeszło 6 scenariuszy testowych limitów map (raport Node: 7 wraz z testem nadrzędnym): brak aktywacji bez potwierdzonych ograniczeń, walidacja operacji/Origin, współbieżność, wspólne limity search/details, rollback limitu miesięcznego, trwałość po restarcie. Testy używały wyłącznie `vanly_test` i fikcyjnego klucza; nie wykonywały żądań Google.
- Rzeczywista strona `http://vanly.local/kempingi` sprawdzona w Chrome: stan oczekiwania, zmiana regionu na Chorwację oraz rodzaju na miejsca dla kamperów prawidłowo aktualizują odnośniki Google Maps. Fikcyjne kempingi nie są pokazywane.
- Widok 390×844: szerokość dokumentu 390, brak przewijania poziomego; formularz mieści się na ekranie. Widok komputera sprawdzony wizualnie. Przywrócono normalny rozmiar przeglądarki.
- Przed aktywacją w dokumencie nie ma skryptu Maps ani ramki Google. Odnośnik do zasad map działa, a strona zasad zawiera opis przekazywania danych i linki Google. Konsola przeglądarki bez błędów.
- Produkcyjne API zwraca dla map `enabled=false`, `available=false`. Serwer, baza i worker działają po restarcie.
- Utworzony pusty projekt Google Cloud `vanly-maps-20260923`. Konsola Google wskazuje brak aktywnych kont rozliczeniowych. Pozostawiono kartę do dokończenia przez użytkownika; brak klucza i brak aktywnego ruchu API.
- **Nie wykonano testu mapy i rzeczywistych wyników Google.** Wymaga aktywacji rozliczeń, utworzenia ograniczonego klucza i weryfikacji twardych limitów Google Cloud. Liczniki Vanly nie są samodzielnym limitem rachunku Google.


## Aktywacja Google Maps — dalsze sprawdzenie 23.09.2026

Poniższy wynik zastępuje wcześniejszy stan oczekiwania na rozliczenia.

- Konto rozliczeniowe Vanly Maps aktywne i połączone z projektem. Warunki oraz ograniczony klucz zostały zatwierdzone przez użytkownika.
- Włączono Maps JavaScript API i Places UI Kit. Klucz ograniczony do obu usług i trzech lokalnych adresów.
- Google przyjął dzienny limit 200 ładowań mapy oraz 250 zapytań Places UI Kit. 3D, Grounding, Advanced Query i Autocomplete Session mają limit zero. Alerty budżetowe: 10, 50 i 100 PLN; alerty nie są blokadą wydatków.
- Po restarcie API zwraca `enabled: true, available: true`.
- Test rzeczywistej strony w Chrome: mapa, 12 wyników dla Mazur, punkty i karty Google ze zdjęciami i ocenami widoczne. Konsola bez błędów w sprawdzonym teście. Kliknięcie punktu otwiera panel szczegółów z odnośnikiem do wybranego miejsca.
- Dalsza kontrola treści szczegółów, zmiany regionu z aktywną mapą i widoku mobilnego zatrzymana przez narzędzie przeglądarki: brak możliwości zweryfikowania polityki administratora dla lokalnej domeny. Blokady nie obchodzono.
- Kod aplikacji podczas aktywacji nie uległ zmianie; wcześniejsze wyniki kompilacji i testów automatycznych pozostają aktualne.


## Kempingi — automatyczny widok Polski (23.09.2026)

Na prośbę użytkownika mapa i jedno wyszukiwanie Polski startują automatycznie po gotowości sesji i sprawdzeniu limitu. Do 20 wyników; skróty regionów wykonują wyszukiwanie, a przycisk „Szukaj w tym obszarze” ogranicza wyniki do aktualnego widoku i zachowuje kadr. Odświeżono informację o połączeniu z Google i stronę prywatności. Przydziały Google i limity aplikacji bez zmian; konfigurację klucza HTTPS użytkownik odłożył.

Kompilacja Next/TypeScript poprawna, 4 testy komponentu z symulowanym Google i 15 testów API zaliczone. Nowy frontend uruchomiony, połączenie z API potwierdzone. Kontroli wizualnej w przeglądarce nie wykonano z powodu niedostępnej weryfikacji polityki administratora narzędzia.

## Rezerwacje przez HTTP — naprawa UUID (23.09.2026)

- Odtworzono `crypto.randomUUID is not a function` przy przejściu do rezerwacji na `http://vanly.local`. Przeglądarka potwierdziła `isSecureContext=false`, brak `randomUUID` i dostępne `getRandomValues`.
- Wspólny generator identyfikatorów żądań korzysta z natywnego UUID, a na HTTP tworzy UUID v4 z `crypto.getRandomValues`. Obsługuje blokadę terminu, płatność testową, zmianę jej scenariusza i operacje na rezerwacji.
- Kompilacja Next.js i TypeScript poprawna. Uruchomiono nowy frontend. 15 testów API i 4 testy generatora UUID zaliczone.
- Test przeglądarkowy domyślnie działa teraz na `http://vanly.local`. Potwierdzono przejście do rezerwacji Weekend 7–28 października 2026 dla 2 osób (7519,00 zł) i sprawdzono wizualnie formularz; zrzut `.local/qa/weekend-checkout.png`.
- Pełna ścieżka Coast: blokada → płatność odrzucona → udana → zmiana terminu → akceptacja firmy → dopłata → odbiór → zwrot → opinia → moderacja. Widoki firmy/operatora, edycja floty i układy mobilne przeszły bez błędów JavaScript.
- Rezerwacje i płatności kontrolne zapisano wyłącznie w `vanly_test`; dane użytkownika w `vanly_local` bez zmian.
