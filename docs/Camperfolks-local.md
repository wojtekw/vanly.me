# Camperfolks — lokalny frontend

Camperfolks jest drugą aplikacją Next.js w tym samym monorepo: `apps/camperfolks`, pakiet `@vanly/camperfolks`. Korzysta z istniejących komponentów, klienta API i danych Vanly. Jego branding jest wybierany osobno od FrontOffice Vanly.

- Camperfolks: `https://camperfolks.com.local`, proces na `127.0.0.1:3104`.
- Vanly: `https://vanly.me.local`, dotychczasowy proces na `127.0.0.1:3100`.
- Wspólne API: `127.0.0.1:4100`; wspólna istniejąca baza i worker Vanly.
- Panele wypożyczalni i operatora zachowują dotychczasowe adresy.

## Uruchomienie i aktualizacja

Źródła są w `/Users/wojtek/Documents/ChatGPT/Vanly.me`, a działające usługi w `/Users/wojtek/.local/share/vanly-portal`. Aktualizacja Camperfolks korzysta z istniejącego mechanizmu wdrażania:

```sh
cd /Users/wojtek/Documents/ChatGPT/Vanly.me
./scripts/deploy-local.sh camperfolks
```

Ta aktualizacja buduje Camperfolks i API, kopiuje nowy frontend oraz wąską obsługę origin przy resecie hasła, a następnie uruchamia API i Camperfolks. Zachowuje procesy oraz pliki buildów działającego Vanly, paneli i workera. Nie nadpisuje `.env.local` instalacji: dopisuje jedynie dokładny origin HTTPS Camperfolks do istniejącej listy. Nie wykonuje migracji, seedowania ani kopii bazy.

Stan i ponowne uruchomienie samego frontendu:

```sh
/Users/wojtek/.local/share/vanly-portal/vanly status
/Users/wojtek/.local/share/vanly-portal/vanly restart camperfolks
/Users/wojtek/.local/share/vanly-portal/vanly start camperfolks
/Users/wojtek/.local/share/vanly-portal/vanly stop camperfolks
```

Usługa `local.vanly.portal.camperfolks` jest LaunchAgentem użytkownika i startuje po zalogowaniu. Logi są w `/Users/wojtek/Library/Logs/Vanly/camperfolks.log` oraz `camperfolks.error.log`. Samodzielny build: `./vanly build-camperfolks`. Pełne `./vanly build` i start/stop bez selektora obejmują wszystkie aplikacje.

## Jednorazowa instalacja lokalnego adresu

Adres obsługuje istniejący systemowy Nginx z `/Library/Application Support/Vanly`, który nasłuchuje na `127.0.0.2:80/443` i dotychczasowych adresach domowej sieci. Drugi Nginx kompatybilności oraz domeny pozostałych projektów pozostają bez zmian. Przekierowanie HTTP Camperfolks prowadzi do HTTPS.

Najpierw sprawdź plan zmian bez uprawnień administratora:

```sh
/usr/bin/python3 /Users/wojtek/Documents/ChatGPT/Vanly.me/ops/install-camperfolks-proxy.py
```

Instalacja wymaga administratora macOS, ponieważ zmienia systemowy hosts, istniejący renderer Nginx i lokalny certyfikat serwera:

```sh
sudo /usr/bin/python3 /Users/wojtek/Documents/ChatGPT/Vanly.me/ops/install-camperfolks-proxy.py --install
```

Instalator dopisuje wyłącznie nową domenę i jej trasę, zachowuje istniejące domeny, CA i klucz prywatny, a do certyfikatu dodaje SAN Camperfolks. Sprawdza konfigurację przez `nginx -t` i przeładowuje istniejący master Nginx. Poprzednie pliki odkłada w `/Library/Application Support/Vanly/camperfolks-backups`; w przypadku błędu odtwarza poprzedni stan. Prywatne klucze ani CA nie są kopiowane do projektu.

## Sesje i bezpieczeństwo

Przeglądarka używa względnego `/api/v1`. Nginx kieruje te żądania do istniejącego API i nadpisuje `X-Vanly-Protocol` według rzeczywistego protokołu. Nie potrzeba globalnego CORS. API dopuszcza tylko dodatkowy dokładny origin `https://camperfolks.com.local`; origin z dopisaną domeną lub niepoprawny CSRF nadal jest odrzucany.

Cookie HTTPS pozostaje `__Host-vanly_session`, `Secure`, `HttpOnly`, `SameSite=Strict`, ze ścieżką `/` i bez `Domain`. Konta oraz dane są wspólne, a sesje przeglądarki przypisane do konkretnego hosta: można zalogować się tym samym kontem na obu stronach. Link resetu hasła używa dokładnego dozwolonego origin strony, z której wysłano żądanie; pozostałe wywołania zachowują `APP_ORIGIN` Vanly.

Camperfolks lokalnie pozostaje wyłączone z indeksowania. Usługi płatnicze i inne integracje zachowują istniejącą konfigurację Vanly.

## Kontrole

```sh
./vanly build
./vanly test-seo
./vanly test-camperfolks-api
NODE_EXTRA_CA_CERTS='/Library/Application Support/Vanly/public/vanly-root.crt' \
  /Users/wojtek/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test tests/camperfolks-http.test.mjs
```

Test `test-camperfolks-api` uruchamia na czas kontroli API na wolnym porcie loopback 4105 z istniejącą bazą i kontem lokalnego podróżnika. Sprawdza zdrowie API, publiczny inwentarz, login/logout, właściwości cookie, ścisły origin, odrzucone żądania bez CSRF oraz wybór zaufanego origin resetu. Usuwa utworzoną sesję i kończy proces testowy. Nie tworzy rezerwacji, płatności, użytkowników ani resetów hasła; nie uruchamia migracji ani seedów.

Test HTTP korzysta z działających adresów obu frontendów. Porównuje katalog, szczegóły oferty, dane API i obrazy pojazdów; sprawdza SSR, wszystkie trasy podróżnika, branding, metadane, manifest, assety, lokalne wyłączenie indeksowania i odrzucenie nieznanego origin. Nie loguje i nie zapisuje nowych danych. Dwa dodatkowe testy CSRF wymagają przekazania istniejących cookies przez `CAMPERFOLKS_TEST_SESSION_COOKIE` i `VANLY_TEST_SESSION_COOKIE`; bez nich są pomijane. Kontrolę cookie oraz CSRF wykonuje również test API opisany wyżej. Zwykły odczyt katalogu i podgląd wyceny zachowują istniejącą rutynę wygaszania przeterminowanych blokad.

## Wynik odbioru — 05.10.2026

Oba adresy HTTPS działają równolegle. Sześć usług aplikacji (`web`, `camperfolks`, `api`, `owner`, `admin`, `worker`) jest uruchomionych. Camperfolks pobiera dotychczasowe dane Vanly, a wygląd i branding Vanly zostały zachowane.

| Kontrola | Wynik |
|---|---|
| Pełny build monorepo | PASS |
| `test-seo` | 10 PASS |
| Testy jednostkowe | 11 PASS |
| `camperfolks-http.test.mjs` | 8 PASS, 2 opcjonalne SKIP |
| `test-camperfolks-api` | 3 PASS |
| UI desktop oraz emulowane szerokości 320 i 390 px | PASS |
| Menu, wyszukiwanie, filtry, szczegóły oferty, galeria, podgląd wyceny, logowanie/wylogowanie i formularze w bezpiecznym zakresie | PASS |
| Google Maps na `/kempingi` w Camperfolks i Vanly | PASS — mapa, 20 miejsc i 20 markerów na każdym froncie, bez `ReferrerNotAllowed` |

Nie wykonywano migracji, seedowania ani kopiowania bazy. Standardowe `./vanly test` i `./vanly test-maps` nie były uruchamiane przy tym odbiorze, ponieważ ich przygotowanie obejmuje migracje i zmiany danych w bazie `vanly_test`. Zamiast nich wykonano wąski test integracyjny autoryzacji dla Camperfolks.

Na istniejącym kluczu Google Maps dopisano dokładne dozwolone witryny `https://camperfolks.com.local/*` i `https://vanly.me.local/*`. Zachowano wszystkie wcześniejsze wpisy i oba istniejące ograniczenia API. Nie utworzono nowego klucza ani usług map. Klucz nie jest zapisywany w tej dokumentacji.

Camperfolks ma własny logotyp `camperfolks.`, faviconę, manifest, grafikę udostępniania, metadane i paletę „Blisko ludzi”. Zachowano dostępne ilustracje podróżnicze z repozytorium, w tym sceny z ludźmi; w projekcie nie było autentycznych fotografii do wykorzystania. Obrazy ofert oraz inne dane pochodzące z backendu pozostają bez zmian. Nie dodano fikcyjnych opinii, liczników ani funkcji społecznościowych.

Pełne tworzenie rezerwacji i płatności nie było weryfikowane; kontrola zatrzymała się na bezpiecznym podglądzie wyceny i istniejących formularzach. Nie sprawdzono dostępu z fizycznego telefonu. Próba w mobilnym rozmiarze przeglądarki nie potwierdza takiego dostępu. Nowy adres jest dodany do hosts na tym Macu; pozostałe urządzenia wymagają własnego rozwiązania nazwy i zaufania istniejącemu lokalnemu CA.
