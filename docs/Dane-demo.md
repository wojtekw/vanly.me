# Dane demonstracyjne rynku

## Wypełniony portal — 7 października 2026 r.

Lokalna baza zawiera 1000 fikcyjnych klientów: do wcześniejszych 100 dodano 900, a profile całej grupy uzupełniono o telefon testowy, adres, datę urodzenia, kierowców, preferencje oraz zgodę marketingową. Nowe konta mają indywidualne hasła. Dotychczasowe loginy i hasła zachowano.

Katalog obejmuje 150 zweryfikowanych wypożyczalni demonstracyjnych: 30 z flotą od 2 do 9 pojazdów oraz 120 z jednym pojazdem, łącznie 267 aut. Dwie wcześniejsze prywatne firmy bez pojazdów pozostają bez zmian. Wszystkie firmy demonstracyjne mają konto właściciela i wyposażenie przypisane do konkretnych pojazdów. Magazyny obejmują 1200 pozycji i 7612 sztuk, m.in. krzesła, foteliki, pościel, stoły, bagażniki, zestawy kuchenne, grille, deski SUP, stacje zasilania i nawigacje. Zachowano wcześniejsze archiwizowane pozycje i ręczne przypisania.

Dodano 500 rezerwacji demonstracyjnych na różnych etapach, 450 rozmów z 3226 wiadomościami, 534 pytania publiczne, 187 opinii powiązanych z zakończonymi wynajmami, 100 zgłoszeń, 600 zadań, 389 protokołów, 60 propozycji zmian oraz 2500 ulubionych. Wszystkie treści i rozliczenia są syntetyczne; opinie nie opisują prawdziwych klientów ani wynajmów. Płatności są wyłącznie lokalnymi testami, wiadomości pozostają w lokalnej skrzynce. Ubezpieczenia, winiety i wysyłka e-mail do usług zewnętrznych pozostają niepodłączone.

Generator: `scripts/populate-world-demo.mjs`; dane katalogu: `scripts/world-demo-fixture.mjs`; aktywność: `scripts/world-demo-activity.mjs`. Import działa wyłącznie na lokalnej bazie `vanly_local`, zapisuje dane w transakcji, sprawdza zachowanie wcześniejszych rekordów i nie powiela danych przy ponowieniu. Przed pierwszym importem utworzono pełną kopię bazy i plików w `/Volumes/Extreme SSD/Vanly/Vanly.me/.local/backups/2026-10-07T10-29-28-775Z`.

Prywatna lista dostępowa znajduje się w `.local/world-demo-credentials.json`; eksport danych do Excela w `.local/world-demo-export.json`. Arkusz z użytkownikami, wypożyczalniami i siedmioma scenariuszami jest zapisywany w działającej instalacji jako `/Users/wojtek/.local/share/vanly-portal/.local/exports/Vanly-konta-demo-2026-10-07.xlsx`. Dwa wcześniejsze prywatne konta nie mają dostępnego jawnego hasła i są oznaczone w arkuszu; ich haseł nie zmieniono. Pliki mają uprawnienia `600` i pozostają poza repozytorium oraz publicznymi zasobami aplikacji.

Kontrola `scripts/verify-world-demo.mjs` sprawdza liczby i profile, floty, przypisania wyposażenia, ceny, wpłaty, kalendarze, relacje opinii i prywatność wiadomości. Sprawdza także prawdziwe logowanie klienta i właściciela oraz utworzenie rezerwacji z dodatkiem i anulowanie blokady kontrolnej. Wyszukiwarka udostępnia do 1000 wyników, dzięki czemu pokazuje wszystkie 267 ofert.

## Pierwotny katalog i źródła — 23 września 2026 r.

Stan źródeł i przygotowania danych: 23 września 2026 r.

Lokalna instalacja zawiera fikcyjny katalog inspirowany strukturą rzeczywistych polskich ofert. Nazwy wypożyczalni, konta, opisy i przypisania pojazdów są demonstracyjne. Nazwy modeli pozostają rzeczywiste, ponieważ dzięki temu filtry, pojemność floty i różnice cenowe przypominają działający rynek. Żadna pozycja nie sugeruje współpracy Vanly z firmą, której cennik posłużył jako punkt odniesienia.

## Zakres

- 12 fikcyjnych wypożyczalni łącznie: 5 wcześniejszych i 7 dodanych na podstawie badania rynku.
- 36 ofert pojazdów łącznie: 6 wcześniejszych i 30 dodanych.
- 270 stawek sezonowych dla nowych ofert, obejmujących okres od stycznia 2026 do marca 2028.
- 100 nowych kont podróżnych.
- Konto właściciela dla każdej wypożyczalni. Dwie wcześniejsze firmy zachowują dotychczasowe konta; dla pozostałych 10 utworzono konta demonstracyjne.

Ceny w bazie są zaokrąglonym odwzorowaniem poziomów cen z aktualnych cenników. Kalendarz sezonów został ujednolicony na potrzeby działania wyszukiwarki. Nie jest kopią kalendarza żadnej konkretnej firmy. Kaucje, minima wynajmu, limity kilometrów i opłaty przygotowawcze mieszczą się w przedziałach widocznych w materiałach źródłowych.

## Źródła rynkowe

- [Krecik Camp — cennik 2026](https://www.kamperymalopolska.pl/cennik): Rapido i96M, Rapido M96, Adria Coral 600 DP; 490–1100 zł/dobę, kaucja 4000 zł.
- [AutoTrip — cennik 2026](https://www.autotrip.com.pl/?pd=cennik): różne stawki dla Polski i Europy, długości wynajmu oraz limitów kilometrów; 350–900 zł/dobę w tabeli dla klasy Comfort.
- [Campventure — cennik 2026](https://www.campventure.pl/cennik_wynajmu_kamperow/): Benimar S340 i Chausson Welcome; 349–699 zł/dobę, kaucje 3500–5000 zł i 350 zł opłaty serwisowej.
- [Kampery Kołobrzeg — flota i cennik 2026](https://kamperykolobrzeg.pl/kampery-na-wynajem-2/): Volkswagen California i Grand California oraz modele Benimar Yrteo, Tessoro i Sport; przykładowo Yrteo 480/550/650 zł.
- [Kampery Łódź — cennik](https://kampery.lodz.pl/cennik-m): Karmann Dexter 560 4×4 oraz Benimar Tessoro i Sport; 390–750 zł/dobę.
- [Wisła66 — cennik 2026](https://www.wisla66.pl/wynajem-kampera-cennik/): modele Benimar; 399/499/649 zł, kaucja 5000 zł, 350 zł za sprzątanie i limity 200–350 km/dobę.
- [Chalifornia — flota i cennik](https://chalifornia.pl/kim-jestesmy/): Volkswagen California Beach, Coast, Ocean i Grand California; typowo 399–669 zł/dobę.
- [NoBoKamper — cennik](https://nobokamper.pl/cennik/): Roller Team Kronos 265/284; 750 zł/dobę w sezonie wysokim i 5000 zł kaucji.

Pełny zapis źródeł, notatek, firm, ofert i stawek znajduje się w `db/marketplace.json`.

## Konta

Lista kont demonstracyjnych jest przechowywana lokalnie w `.local/demo-accounts.json` z uprawnieniami tylko dla właściciela pliku. Nie trafia do interfejsu ani publicznych plików aplikacji. Wszystkie nowe konta mają wspólne hasło przeznaczone wyłącznie do testów lokalnych. Pierwsze konto podróżnego to `podroznik001@demo.vanly.local`. Przykładowe konto firmy to `wlasciciel.morski-szlak@demo.vanly.local`.

Import można odtworzyć poleceniem `pnpm db:demo-market`. Skrypt odmawia pracy z bazą inną niż lokalna `vanly_local`, wykonuje zapis w transakcji i tworzy kopię zastępowanych rekordów w `.local/backups`.
