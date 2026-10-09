# VANLY UAT

## Aktualizacja logiki płatności — 9.10.2026

Nowe rezerwacje podróżujących nie wymagają wpłaty w VANLY. Najem i kaucję
rozlicza wypożyczalnia. Pierwszy pojazd jest bezpłatny; dodanie drugiego i każdego
kolejnego kosztuje 200 zł jednorazowo. W UAT opłata za flotę jest testowa.
[Pełne zasady i migracja](../../docs/Platnosci-start.md).

Kolejne wydania przygotuj z zatwierdzonego kodu Git przez `git archive`.
`update-host.sh ARCHIWUM COMMIT` buduje nowy obraz przed zatrzymaniem aplikacji,
zapisuje kopię bazy i dotychczasowego kodu, wykonuje migracje oraz uruchamia
istniejące usługi. Zachowuje prywatne ustawienia, dane i uploady. Nie importuje
lokalnej bazy i nie zmienia CloudFront, DNS ani Basic Auth. Commit wdrożenia
zapisuje w `/opt/vanly-uat/data/deployed-commit`.

`prepare-release.py` opisany poniżej służył do pierwszego przeniesienia lokalnego
runtime. Nie używaj go do aktualizacji nowego modelu: skopiowałby starszy kod.
Po wdrożeniu uruchom `smoke-published.mjs public`, wskazując prywatny katalog
przez `VANLY_UAT_PRIVATE_DIR` i plik kont testowych przez `VANLY_UAT_ACCOUNTS`.
Test sprawdza dostęp HTTPS, rezerwację bez wpłaty i granice opłat za flotę.

Adresy docelowe: `https://uat.vanly.me`, `https://owner.uat.vanly.me`,
`https://admin.uat.vanly.me`. Stan: **opublikowane i sprawdzone 9.10.2026**.

Zakres ustalony 9.10.2026: testy z klientami, obecny portal, osobne panele,
API, worker i wydzielona kopia danych. Płatności testowe. Ubezpieczenia i winiety
poza zakresem. Staging i zgodność infrastruktury 1:1 z produkcją są osobnym etapem.

Host docelowy: Lightsail `medium_3_0`, Ubuntu 24.04, Frankfurt, 4 GB / 2 vCPU,
80 GB, 24 USD/miesiąc. Odczyt AWS potwierdził cenę pakietu i brak istniejących
EC2/Lightsail we Frankfurcie. Prognoza dotychczasowego konta: 10,11 USD/miesiąc.
Limit całego konta pozostaje 50 USD. Budżet jest alertem, nie automatyczną blokadą kosztów.

Wejście: osobna dystrybucja CloudFront z wyłączonym cache i przekazaniem wszystkich
headers poza Host (`AllViewerExceptHostHeader`), cookies i query string. Funkcja
`viewer-host.js` nadpisuje `X-Vanly-Viewer-Host` z rzeczywistego hosta klienta.
Origin to `origin.uat.vanly.me` z osobnym certyfikatem TLS. CloudFront dodaje
losowy `X-Vanly-Origin`; Nginx blokuje wejście bez niego. Wszystkie trzy aplikacje,
API, pliki i dokumenty mają Basic Auth oraz `noindex` i `no-store`.

Prywatna konfiguracja (poza obrazem i repozytorium): `/opt/vanly-uat/private/`.
Hasło Basic Auth zapisuje się wyłącznie jako bcrypt. Dane i uploady:
`/opt/vanly-uat/data/`. PostgreSQL i procesy aplikacji nasłuchują wyłącznie lokalnie.
SSH dopuszcza tylko wybrany publiczny adres IP komputera operatora.
Zgodę na nowy klucz SSH użytkownik udzielił 9.10.2026. Klucz prywatny pozostaje
na komputerze operatora, poza repozytorium i obrazem aplikacji.

`prepare-release.py` kopiuje kod z działającego runtime i nakłada wyłącznie zmianę
adresów paneli oraz możliwość wstrzyknięcia dostawcy poczty do workera UAT.
Zachowuje oddzielny manifest. Aktualny eksport danych pomija sesje,
tokeny resetu/weryfikacji, stare zadania, outbox i idempotency; nie jest
publikowany jako plik WWW. Pozostałe funkcje i dane demonstracyjne są zachowane.

`test_gateway.py` uruchamia odizolowany Nginx i atrapy upstreamów; sprawdza brak
dostępu bez hasła, poprawne i błędne hasło, blokadę bez nagłówka originu,
prywatne dokumenty/API, nagłówki noindex/no-store i usunięcie Authorization przed
przekazaniem do aplikacji. macOS używa APR1 w teście; docelowy plik na Linuxie
używa bcrypt. Te same testy są uruchamiane także na Linuxie z bcrypt.

Build API, Next.js i obu paneli przeszedł zarówno na Linux ARM64, jak i natywnie
na docelowym Ubuntu 24.04 AMD64. Obraz wdrożenia: `vanly-uat:current`,
SHA256 `bbf5ddc36df21cab0c5612c71d2ed6b7c1f772b89c51559e07a926a829aaa49f`.
Zależności macOS nie są kopiowane na Linuxa.

## Integracje w tym wydaniu

| Usługa | Wariant UAT i aktualny stan |
| --- | --- |
| Rezerwacje, panele, dokumenty, wiadomości | Obecna logika aplikacji, osobny PostgreSQL i trwałe pliki. Pełny przebieg testowy na Linuxie przeszedł. |
| Płatności | Obecny symulator wpłaty, dopłaty i zwrotu. **Brak rzeczywistego połączenia z Autopay sandbox**; potrzebne konto testowe i dane integracji. |
| Google Maps / kempingi | Obecny klucz i limity. 9.10.2026 dodano dokładnie `https://uat.vanly.me/*`; po ponownym otwarciu konsoli potwierdzono zapis i ograniczenia do Maps JavaScript API oraz Places UI Kit. Na publicznym UAT potwierdzono mapę, 20 wyników wyszukiwania i zdjęcia oraz szczegóły wybranego kempingu. |
| Poczta SES | Przygotowany dotychczasowy profil ograniczony do jednego odbiorcy testowego. Worker UAT dodatkowo zapisuje wiadomość w prywatnej skrzynce danego klienta w portalu. Z serwera UAT SES przyjął 6 wiadomości testowych (`accepted`); wszystkie zadania zakończono. Odbiór w skrzynce Gmail nie był osobno sprawdzany. |
| Treści i media | Dotychczasowe dane oraz pliki. S3 i Sanity nie są w tej wersji dostawcami; ta różnica względem planowanej produkcji nie ogranicza obecnych funkcji testowych. |
| Ubezpieczenia i winiety | Pominięte zgodnie z decyzją użytkownika. |

`prepare-private.mjs` generuje oddzielne dane połączenia UAT, kopiuje wyłącznie
profil SES `vanly-mailer-test` i aktualne ograniczone ustawienia map. Pliki mają
tryb 600 i nie trafiają do kontekstu obrazu. `install-host.sh` wymaga nowego hosta
Ubuntu 24.04 oraz odmawia odtworzenia eksportu na niepustej bazie bez zgodnego
znacznika wcześniej zakończonego importu. Żaden z tych skryptów nie modyfikuje
lokalnego runtime ani lokalnej bazy.

Wyniki kontroli na kopii danych: bezpieczne ciasteczka sesji, granice ról,
rejestracja, wycena, blokada terminu, testowa płatność z idempotency, potwierdzenie,
pobranie PDF, rozmowa klienta z firmą, dopłata, anulowanie, zwrot oraz dostarczenie
wiadomości do prywatnej skrzynki. Dodatkowo 14 testów izolacji wysyłki testowej
i 4 testy bramy dostępu na macOS oraz Linuxie z bcrypt przeszły. Eksport zachowuje wszystkie 72 klucze obce,
w tym powiązanie rezerwacji z wyceną.

## Wdrożenie i kontrola publicznego UAT

Lightsail: `vanly-uat`, stały IPv4 `63.188.247.222`, origin
`origin.uat.vanly.me`. CloudFront: `E1EI2PWSQE79XF`,
`d1mw7g5551fyf.cloudfront.net`, trzy osobne rekordy CNAME UAT.
ACM w `us-east-1`: `21cab112-9e18-4207-9c2b-105f282576db`, certyfikat wydany.
CloudFront Function `vanly-uat-viewer-host` działa na etapie LIVE.
Origin ma osobny certyfikat Let's Encrypt i automatyczne odnawianie.
Nowe zasoby mają oznaczenia Project=VANLY, Environment=UAT.

Test `smoke-published.mjs` przeszedł przez publiczny CloudFront. Potwierdzono
401 bez Basic Auth i dla błędnego hasła; 200 z hasłem na trzech domenach;
ochronę API, plików i PDF; `noindex` oraz `no-store`; bezpośredni origin zwraca
403. Działają rejestracja, bezpieczna sesja, oddzielne logowanie w panelach,
role użytkowników, wycena, blokada terminu, płatność symulowana i idempotency,
potwierdzenie, dokument PDF, wiadomości, dopłata, anulowanie, zwrot i prywatna
skrzynka. Rezerwacja testowa ma dokładnie trzy wpisy płatności; baza zachowuje
wszystkie 72 klucze obce. Google Maps / Places sprawdzono również w Chrome.

Konfiguracja Nginx używa `map_hash_bucket_size 128`, wymaganej dla długiego,
losowego klucza originu. Prywatne pliki nie są publikowane ani dodawane do
kontekstu obrazu. Portal, panele, worker i baza uruchamiają się ponownie po
restarcie hosta. Dotychczasowa strona `vanly.me` ma osobną dystrybucję.

Skrypty `provision-host.py` i `provision-edge.py` działają w zalogowanym
CloudShell właściwego konta i odmawiają nadpisania niezgodnych zasobów. Stan
wdrożenia oraz wyniki testu zapisano prywatnie w `.local/uat/`. Hasła i klucze
należy przekazywać wyłącznie przez pliki prywatne, nie przez opis zadania lub wiki.

Źródła konfiguracji:
- https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-bundles.html
- https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/add-origin-custom-headers.html
- https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesOrigin.html

Przy kolejnych aktualizacjach powtórzyć kontrolę HTTPS i właściwy test
przebiegu użytkownika. Płatności z Autopay sandbox pozostają osobnym etapem
wymagającym danych z konta testowego Autopay.
