# Vanly. Projekt interfejsu 3.0

Aktualizacja: 23 września 2026.

## Otwórz projekt

`Vanly_projekt_MVP_v3.html` jest samodzielnym, klikalnym plikiem. Działa offline, bez instalacji. Dolny pasek przełącza perspektywę podróżnika, wypożyczalni i operatora Vanly. Przy pierwszym otwarciu są dostępne dwie rezerwacje i pytanie demonstracyjne. Opcja „Wyczyść dane demo” odtwarza stan początkowy wersji 3.0.

Przykładowe dane zapisują się wyłącznie w tej przeglądarce. Używaj danych testowych. Oddzielna przestrzeń zapisu `vanly.v3` nie nadpisuje danych poprzedniego prototypu.

## Kierunek graficzny i język

Zachowano logo, ilustracje, zieleń, ciepłą biel i podróżniczy charakter wcześniejszego projektu. Nagłówek hero jest teraz rzeczywistym tekstem w kroju Kalam, a nie bitmapą. Pozostały interfejs korzysta z lokalnego kroju systemowego. Plik zawiera osadzony font i ilustracje, więc nie wymaga zewnętrznych żądań.

Podróżnik widzi wybór pojazdu, cenę i kolejne kroki. Panel firmy akcentuje decyzje i pracę przy flocie. Panel operatora zaczyna od spraw wymagających obsługi. Techniczne założenia infrastruktury pozostają w dokumentacji, poza głównymi ścieżkami produktu.

Skille wydmuch-copywriter i wydmuch-graphicdesigner zastosowano jako warsztat redakcyjny i projektowy. Oferta konsultanta, jego osobisty głos i branżowe słownictwo nie zostały przeniesione do marki Vanly. Zachowano polski język źródłowego interfejsu.

## Co zmieniono względem HTML 2.0

| Obszar | Aktualizacja |
|---|---|
| Strona główna | Edytowalny nagłówek, wcześniejsza ekspozycja pojazdów, cztery kroki od wyboru do odbioru, odświeżona hierarchia sekcji. |
| Wyszukiwanie | Dodatkowe filtry wyposażenia: kuchnia, prysznic i ogrzewanie; poprawione karty oraz widok mobilny. |
| Oferta | Cena całego pobytu, oddzielna kaucja, dostępność dodatków w terminie, zestaw wyposażenia, poglądowy plan wnętrza i zaprojektowany stan braku filmu. |
| Rezerwacja | Zestaw krzeseł i pościeli, aktualizacja wyceny, widoczny harmonogram zaliczki, dopłaty i kaucji. |
| Konto i podróż | Nowe podsumowanie podróży z niezależnymi statusami, dokumentami, kierowcami, kontaktem i krokami przed odbiorem. |
| Zmiana terminu | Prośba klienta, nowa wycena, symulacja uzgodnienia przez obie strony, zachowanie wcześniejszych warunków, oddzielne rozliczenie różnicy. |
| Płatności | Symulacja dopłaty, pełnego i częściowego zwrotu. Kaucja pozostaje poza ceną wyjazdu. |
| Panel firmy | Osobny nagłówek roboczy, wypełniony pulpit, filtr rezerwacji, szczegóły podróży, widoczne bufory przygotowania w kalendarzu. |
| Magazyn | Zestawienie puli, rezerwacji i dostępnych ilości dla dat; lokalna alokacja dodatków w obrębie firmy. |
| Operacje | Tablica przygotowania, odbioru i zwrotu; zapis protokołu właściwego typu i historii protokołów. |
| Opinie i pytania | Oddzielny widok firmy, zapis odpowiedzi przy przykładowej opinii, publikacja pytania po moderacji. |
| Finanse firmy | Oddzielne wpłaty, dopłaty i kaucje; rozróżnienie wpłaty, transferu i wypłaty. |
| Panel Vanly | Kolejka niepotwierdzonych usług, zwrotów i zmian; przykładowa sprawa o kaucję z notatką w historii. |
| Telefon | Zmieniony kadr ilustracji i kolejność elementów, przewijana nawigacja paneli, stały przycisk rezerwacji na ofercie, poprawione tabele i filtry. |

## Powiązanie z dokumentacją MVP

Podstawa: `Vanly_architektura_MVP_v1.pdf`, wersja 1.0 z 20.09.2026. Dokument jest materiałem projektowym, nie instrukcją uruchomienia infrastruktury ani potwierdzeniem wdrożenia.

- Strona 4: FrontOffice, wyszukiwanie, karta pojazdu, dodatki, konto, dokumenty, odbiór i zwrot, treści oraz mapa.
- Strona 5: zakres obu paneli, flota, operacje, finanse, firma, moderacja, sprawy i CMS.
- Strona 9: blokada terminu, dostępność, odrębność statusów rezerwacji, płatności i usług.
- Strona 10: zaliczka i dopłata, warunkowa dostępność metod płatności, oddzielna kaucja i rozliczenia.
- Strona 12: rozdzielenie pytań i opinii, odpowiedź firmy, uzasadnienie moderacji.
- Strona 13: plan i media pojazdu, osobny stan realizacji każdej usługi, mapa i dokumenty.

Wcześniejsze pomysły potwierdzono w dostępnych zadaniach „Zaprojektuj serwis wynajmu kempingowego” i „Aktualizacja projektu graficznego”. Dostępna historia wcześniejszej rozmowy nie zwracała oryginalnych obrazów jako załączników. Faktyczną bazą wizualną są ilustracje osadzone w dostarczonym HTML.

## Zakres demonstracji a wdrożenie

To projekt UI i lokalny prototyp, nie działająca platforma MVP. Pełny zakres produktu z dokumentacji nie został podzielony na funkcje „przed MVP” i „po MVP”. Stopień wykonania w tym pliku opisuje jedynie szczegółowość prezentacji.

Działają lokalne scenariusze wymienione w tabeli oraz zachowane ścieżki HTML 2.0. Logowanie jest symulowane. Brak rzeczywistych płatności, polis, winiet, wysyłki wiadomości i kontroli dostępu. Mapa i lokalizacje punktów są poglądowe; promień wyszukiwania nadal jest kontrolką prezentacyjną. Układ wnętrza jest schematem, a materiał wideo wymaga dodania przez firmę. W ilustracjach ofert zachowano rozdzielczość dostarczonych materiałów.

W niektórych obszarach pozostała prezentacja struktury, a nie pełny formularz operacyjny: role i uprawnienia, weryfikacja firmy, dane kierowców, konfiguracja Connect, sezony, kupony, promocje, CMS, raportowanie, oddziały i integracje zewnętrzne. Produkcyjna weryfikacja uprawnienia do opinii, transakcyjna dostępność pojazdów i magazynu, trwałość rozliczeń oraz bezpieczeństwo wymagają backendu.

Kwoty, firmy, oceny, ceny usług, zaliczka 30%, dopłata na 7 dni przed odbiorem oraz bezkosztowe anulowanie to przykładowe decyzje z prototypu. Nie są zatwierdzonymi warunkami oferty Vanly. Stawki prowizji, realni partnerzy, kwalifikacja metod płatności i zasady kaucji pozostają do ustalenia przed produkcją.

## Kontrola jakości

Zweryfikowano pełny scenariusz rezerwacji z wyposażeniem i usługą, poprawność wyceny, ilości magazynowe między firmami, dopłatę, zmianę terminu z historią, częściowy zwrot, akceptację firmy, niezależną realizację polisy, protokół zwrotu, odpowiedź na opinię, obsługę sprawy, moderację, filtry i menu mobilne.

Przeprowadzono 104 kontrole szerokości: 26 widoków przy 320, 390, 768 i 1440 px. Oglądano reprezentatywne widoki desktop i mobile. Kontrola klawiatury obejmowała menu i zamykanie okien; nie jest to formalny audyt WCAG. W testach nie wykryto błędów JavaScript, nieobsłużonych akcji ani połączeń do usług zewnętrznych.

## Pliki do dalszej pracy

- `Vanly_projekt_MVP_v3.html`: samodzielny plik do otwarcia w przeglądarce.
- `Vanly_przeglad_projektu_v3.pdf`: przegląd 10 plansz.
- `screens/`: pełne widoki; `screens/viewport/`: kadry użyte w PDF.
- `source/design.css` i `source/design.js`: nowe style i interakcje.
- `source/base-v2.html`: kopia dostarczonej bazy, bez zmiany oryginału.
- `source/build.py`: składa bazę, style, font i interakcje w samodzielny HTML; wymaga standardowego Pythona 3.
- `source/OFL-Kalam.txt`: licencja fontu Kalam; autor fontu zgodnie z licencją.
- `source/verification.json`: zapis wykonanych sprawdzeń.

Nie zmieniono dokumentów źródłowych ani pliku HTML użytkownika. Nie opublikowano strony w internecie.
