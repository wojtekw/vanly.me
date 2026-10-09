# Heyvans — trzeci lokalny frontend

Heyvans jest osobną aplikacją Next.js w `apps/heyvans`, pakiet `@vanly/heyvans`, z własnym buildem i procesem. Cienkie re-exporty współdzielą funkcjonalność FrontOffice: katalog, filtry, szczegóły ofert, poradniki, kempingi, logowanie, konto i proces rezerwacji. Wybór `NEXT_PUBLIC_PORTAL_BRAND=heyvans` oraz zakres `data-brand="heyvans"` oddzielają jego prezentację od Vanly i Camperfolks.

| Usługa | Adres lokalny | Proces |
|---|---|---|
| Heyvans | `https://heyvans.com.local` | `127.0.0.1:3106` |
| Vanly | `https://vanly.me.local` | `127.0.0.1:3100` |
| Camperfolks | `https://camperfolks.com.local` | `127.0.0.1:3104` |
| Wspólne API | względne `/api/v1` na każdym froncie | `127.0.0.1:4100` |
| Panel wypożyczalni | `https://owner.vanly.me.local` | `127.0.0.1:8182` |
| Panel operatora | `https://admin.vanly.me.local` | `127.0.0.1:8183` |

Trzy marki korzystają z tej samej istniejącej bazy PostgreSQL, kont, katalogu, dostępności, wycen, rezerwacji i lokalnych płatności testowych oraz tego samego workera. Dodanie marki nie wymaga migracji, seedowania, kopii danych ani dodatkowego backendu. Dotychczasowe ustawienia płatności i pozostałych integracji są wspólne; oznaczenia płatności testowych pozostają w interfejsie.

## Uruchamianie i selektywna aktualizacja

Źródła są w `/Users/wojtek/Documents/ChatGPT/Vanly.me`, a działające usługi w `/Users/wojtek/.local/share/vanly-portal`. Aktualizuj Heyvans ze źródeł:

```sh
cd /Users/wojtek/Documents/ChatGPT/Vanly.me
./scripts/deploy-local.sh heyvans
```

Polecenie buduje Heyvans i API, przenosi build Heyvans oraz API do istniejącej instalacji i uruchamia oba procesy. Zachowuje buildy i procesy Vanly, Camperfolks, paneli oraz workera. Kopiowanie źródeł pomija `.env.local` i `.local`; do konfiguracji działającego API dopisywany jest jedynie dokładny origin HTTPS Heyvans. Nie wykonuje migracji ani operacji przygotowujących bazę testową.

```sh
/Users/wojtek/.local/share/vanly-portal/vanly status
/Users/wojtek/.local/share/vanly-portal/vanly start heyvans
/Users/wojtek/.local/share/vanly-portal/vanly restart heyvans
/Users/wojtek/.local/share/vanly-portal/vanly stop heyvans
```

LaunchAgent użytkownika `local.vanly.portal.heyvans` uruchamia frontend po zalogowaniu. Logi są w `/Users/wojtek/Library/Logs/Vanly/heyvans.log` i `heyvans.error.log`. Samodzielny build: `./vanly build-heyvans`. Pełny `./vanly build` obejmuje wszystkie frontendy; start/stop bez selektora obejmuje wszystkie usługi.

## Jednorazowa instalacja domeny i HTTPS

Istniejący systemowy Nginx w `/Library/Application Support/Vanly` otrzymuje nową trasę do portu 3106, przekierowanie HTTP → HTTPS oraz `/api/v1/` do wspólnego API. Instalator zachowuje dotychczasowe domeny, adresy nasłuchu, lokalne CA i klucze prywatne. Dopisuje nazwę Heyvans do hosts oraz SAN istniejącego certyfikatu serwera.

Najpierw sprawdź przygotowaną zmianę:

```sh
/usr/bin/python3 /Users/wojtek/Documents/ChatGPT/Vanly.me/ops/install-heyvans-proxy.py
```

Zmiana systemowego hosts, konfiguracji Nginx i certyfikatu wymaga uwierzytelnienia administratora macOS:

```sh
sudo /usr/bin/python3 /Users/wojtek/Documents/ChatGPT/Vanly.me/ops/install-heyvans-proxy.py --install
```

Instalator tworzy kopię w `/Library/Application Support/Vanly/heyvans-backups`, sprawdza konfigurację przez `nginx -t`, przeładowuje istniejący master i przy błędzie odtwarza poprzednie pliki. Po powodzeniu wypisuje dokładne polecenie wycofania. Ręczne wycofanie używa tej konkretnej kopii:

```sh
sudo /usr/bin/python3 /Users/wojtek/Documents/ChatGPT/Vanly.me/ops/install-heyvans-proxy.py \
  --rollback '/Library/Application Support/Vanly/heyvans-backups/TIMESTAMP'
```

Zastąp `TIMESTAMP` nazwą kopii wypisaną przez instalator. Wycofanie odmawia nadpisania konfiguracji, jeżeli zmieniła się od instalacji. CA i klucze prywatne nie trafiają do projektu.

Instalację systemową wykonano 06.10.2026 z uwierzytelnieniem administratora użytkownika. Po selektywnym wdrożeniu Heyvans odpowiada HTTP 200 pod zaufanym HTTPS. Potwierdzono wspólne API przez nową domenę oraz HTTP 308 zachowujące ścieżkę i query.

## Origin, sesje i reset hasła

Przeglądarka wysyła żądania do względnego `/api/v1` na własnym hoście. Proxy nadpisuje `X-Vanly-Protocol` zgodnie z rzeczywistym protokołem, a API pozostaje na loopback. `APP_ADDITIONAL_ORIGINS` otrzymuje wyłącznie `https://heyvans.com.local`, z zachowaniem wcześniejszych wpisów. Nie jest potrzebne poszerzenie CORS ani zmiana kodu backendu: istniejące `allowedAppOrigins()` obsługuje dodatkowe dokładne originy.

Cookie HTTPS ma nazwę `__Host-vanly_session`, `Secure`, `HttpOnly`, `SameSite=Strict`, ścieżkę `/` i brak `Domain`. Te same konta działają na wszystkich markach, a przeglądarka zachowuje osobną sesję na każdym hoście. Operacje uwierzytelnionego użytkownika nadal wymagają właściwego CSRF. Nieznany origin, dopisana domena, alternatywny protokół i brak origin pozostają odrzucane.

`AuthController.forgot()` używa istniejącego `trustedRequestOrigin(req)` przy składaniu linku resetu. Funkcja wybiera dokładny origin z listy dozwolonych, więc link Heyvans wraca na `https://heyvans.com.local/reset`; żądanie bez zaufanego origin zachowuje `APP_ORIGIN` Vanly. Test wyboru origin nie tworzy tokenu ani wiadomości i nie zmienia hasła użytkownika.

## Projekt, assety i metadane

Wdrożona prezentacja wynika z projektu `heyvans-rebrand-2026-10-06`: neutralne tło, pomarańczowy detal, kolorowe fotografie, Barlow Condensed i Manrope. Główne hasła to „Hej, po przygodę.” oraz „Twoja baza. Twój następny ruch.” Wyszukiwarka i CTA korzystają z istniejących tras i funkcji podróżnika na hoście Heyvans.

Logo, faviconę, grafikę udostępniania, trzy fotografie kampanii oraz fonty i licencje zapisano w `apps/frontoffice/public/assets/heyvans`, współdzielonym przez nową aplikację. Fotografie kampanii są koncepcyjne; rzeczywiste zdjęcia ofert, dane i ceny pochodzą z backendu. Heyvans ma własny `/manifest.webmanifest`, canonicale, Open Graph i dane strukturalne pod `https://heyvans.com.local`. Lokalne indeksowanie pozostaje wyłączone.

Na istniejącym kluczu Google Maps dopisano tylko `https://heyvans.com.local/*`, korzystając z Chrome użytkownika. Zachowano pięć wcześniejszych referrerów oraz ograniczenia Maps JavaScript API i Places UI Kit. Zapis potwierdzono ponownym otwarciem ustawień; dowód jest w `output/verification/heyvans/maps-referrer.jpg`. Nie utworzono klucza ani usługi chmurowej; klucz nie jest publikowany w dokumentacji. W działającej przeglądarce wszystkie trzy frontendy pokazały po 20 markerów kempingów, bez błędu `ReferrerNotAllowed`; sprawdzono też mobilny układ Heyvans.

## Kontrole bez rezerwacji i płatności

```sh
cd /Users/wojtek/Documents/ChatGPT/Vanly.me
./vanly build-api
./vanly build-heyvans
./vanly test-heyvans-api
./vanly test-seo
NODE_EXTRA_CA_CERTS='/Library/Application Support/Vanly/public/vanly-root.crt' \
  ./vanly test-heyvans-http
```

`test-heyvans-api` uruchamia tymczasowy proces API na wolnym porcie loopback z istniejącą bazą i istniejącym kontem lokalnego podróżnika. Sprawdza trzy originy, publiczny inwentarz, login/logout, cookie HTTPS, oddzielenie cookie HTTP, CSRF, odrzucenie nieznanych originów oraz wybór origin linku resetu. Usuwa własne sesje i kończy proces. Nie uruchamia migracji, seedowania, tworzenia kont, resetów, wycen, rezerwacji ani płatności.

`test-heyvans-http` korzysta z działających trzech domen z weryfikowanym TLS. Porównuje katalog, szczegóły i obrazy ofert oraz bezpieczny podgląd wyceny obliczony w groszach. Sprawdza SSR, własny branding, wszystkie istniejące trasy podróżnika, metadane, manifest, assety, fonty, licencje, lokalne noindex, HTTP → HTTPS, dokładne originy oraz login/logout i CSRF przez każdy rzeczywisty proxy. Tworzy i usuwa wyłącznie własne sesje. Podgląd wyceny nie zapisuje rekordu wyceny ani rezerwacji. Odczyt katalogu i podgląd wyceny zachowują rutynę wygaszania przeterminowanych blokad istniejącego API.

Do diagnostyki procesów można wskazać `HEYVANS_BASE_URL=http://127.0.0.1:3106`, `VANLY_BASE_URL=http://127.0.0.1:3100` i `CAMPERFOLKS_BASE_URL=http://127.0.0.1:3104`. Dla takich adresów test nie potwierdza domen, HTTPS ani przekierowania systemowego proxy. Nie zastępuje też kontroli interfejsu w przeglądarce.

Pełne `./vanly test` i `./vanly test-maps` przygotowują własną bazę `vanly_test` przez migracje i zmiany danych. Kontrola dodania Heyvans używa opisanych wyżej wąskich testów istniejącego zaplecza.

## Wyniki — 06.10.2026

| Kontrola | Wynik |
|---|---|
| Build API oraz osobne buildy Heyvans, Vanly i Camperfolks | PASS |
| `test-heyvans-api` | 4 PASS |
| Build Heyvans i selektywne wdrożenie | PASS |
| `test-seo` | 10 PASS |
| Systemowe hosts, proxy, zaufany HTTPS i HTTP → HTTPS | PASS |
| `test-heyvans-http` przez trzy działające domeny HTTPS | 10 PASS, bez pominięć |
| Siedem usług aplikacji (`web`, `camperfolks`, `heyvans`, `api`, `owner`, `admin`, `worker`) | Uruchomione |
| Wspólny katalog, szczegóły, obrazy i podgląd wyceny na trzech frontach | PASS |
| Login/logout, cookie HTTPS, CSRF i ścisły origin przez trzy proxy | PASS |
| UI desktop 1280 px i widoki mobilne 320/390 px | PASS, bez przewijania poziomego; wszystkie pięć pozycji menu dostępne |
| Google Maps na trzech frontendach | PASS, po 20 markerów, bez błędu referrera |
| Zachowanie działających buildów i procesów Vanly, Camperfolks oraz paneli | PASS, identyfikatory buildów i PID-y bez zmian |

Vanly i Camperfolks nadal działają równolegle z Heyvans. Test HTTPS potwierdził identyczne dane istniejącego katalogu, szczegóły, obrazy i wycenę na wszystkich trzech adresach oraz zachowanie brandingu obu wcześniejszych frontendów. Nie utworzono nowych rezerwacji, płatności ani resetów; sesje testowe wylogowano. Nie wykonywano migracji, seedowania ani kopii bazy.

W przeglądarce sprawdzono stronę główną, wyszukiwanie z miastem i zmianą daty, filtr typu pojazdu, szczegóły oferty, galerię, podgląd wyceny, login/logout i konto. Przy szerokości 320 px obejrzano też katalog, ofertę, logowanie, poradniki i kempingi. Poprawiono dopasowanie sekcji wypożyczalni do 320 px i dostępność wszystkich pozycji rozwijanego menu. Zrzuty działającego interfejsu są w `output/verification/heyvans`: `desktop.jpg`, `mobile-320.jpg`, `mobile-390.jpg`, `mobile-menu-320.jpg`, `mobile-menu-390.jpg`, `catalog-320.jpg`, `offer-320.jpg`, `login-320.jpg`, `guides-320.jpg`, `camps-320.jpg` oraz `maps-working.jpg`. `maps-all-brands.json` zawiera wyniki trzech map. Szczegółowy dowód zachowania konfiguracji jest lokalnie w ignorowanym `.local/heyvans-qa/infra-preservation.json`.

Kontrola widoków telefonu odbyła się w przeglądarce na tym Macu. Fizycznego telefonu nie testowano; dostęp z niego wymaga rozwiązania nazwy lokalnej i zaufania istniejącemu CA na urządzeniu. Pełnego zapisywanego cyklu rezerwacji i płatności oraz wysyłki prawidłowego resetu hasła nie wykonywano podczas odbioru. Test trasy `/rezerwacja` używa fikcyjnego UUID i anonimowego widoku; reset sprawdzono przez wybór zaufanego origin, odrzucenie nieprawidłowego żądania i kontrolę powiązania tej funkcji z `AuthController.forgot()`.
