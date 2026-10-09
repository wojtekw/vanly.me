# VANLY — portal lokalny

**Zmiana 9.10.2026:** podróżujący rezerwują bez wpłat w VANLY, a najem i kaucję
rozliczają z wypożyczalnią. Każdą rezerwację potwierdza wypożyczalnia; statusy to
Niepotwierdzona, Anulowana, Odrzucona i Potwierdzona. Pierwszy pojazd jest bezpłatny; publikacja
drugiego i każdego kolejnego kosztuje 1 Credit za miesiąc (1 Credit = 200 zł).
Portfel firmy odnawia publikacje automatycznie; brak Creditsów ukrywa ofertę. Na UAT zakup jest
testowy. [Zasady i zachowanie API](docs/Platnosci-start.md). Opisy zaliczek i dopłat
w starszej dokumentacji dotyczą zachowanych rezerwacji testowych.

Kod portalu znajduje się w tym katalogu. Podstawą jest architektura z `output/architecture/architektura-vanly.md` i zatwierdzony projekt `docs/prototype-v3.html`.

## Aplikacje

- `apps/frontoffice`: Next.js, katalog, wyszukiwarka, oferty, rezerwacje i konto podróżnika; port 3100.
- `apps/owner`: osobny build React/Vite, panel wypożyczalni; port 8182.
- `apps/admin`: osobny build React/Vite, panel operatora; port 8183.
- `apps/api`: NestJS/Fastify, sesje, CSRF, autoryzacja, wycena i operacje PostgreSQL; port 4100.
- `apps/worker`: niezależny proces trwałej kolejki PostgreSQL i wygaszania blokad.
- `packages/ui`: wspólne komponenty, style i adapter nawigacji paneli.

W lokalnym wariancie procesy zastępują cztery projektowane maszyny. PostgreSQL pozostaje istniejącą, wydzieloną bazą `vanly_local`. Lokalny portal nie wymaga zasobów AWS. Kwoty są liczone przez API w groszach; alokacje pojazdów chroni constraint, magazyn — blokady transakcyjne. Dane istniejącego portalu zostały zachowane. Konfiguracja i lokalne pliki pozostają ignorowane przez Git.

Drugi frontend działa równolegle pod `https://camperfolks.com.local`, na porcie 3104, ze wspólnym API i bazą Vanly. Uruchomienie, aktualizacja i wyniki odbioru: [Camperfolks — lokalny frontend](docs/Camperfolks-local.md).

## Uruchomienie

Stan 05.10.2026: konfiguracja systemowego Nginx jest przygotowana, a instalacja i usuwanie pozostałych usług Caddy trwają. Portal korzysta z systemowej usługi `local.nginx.compat`, której pliki znajdują się w `/Library/Application Support/LocalNginx`; dawne preview jako osobna usługa jest wyłączone. Docelowe adresy HTTPS pozostają bez zmian. Odbiór końcowy nastąpi po zakończeniu instalacji. Inne urządzenia wymagają osobnej instalacji publicznego certyfikatu CA.

Instalacja uruchomieniowa: `/Users/wojtek/.local/share/vanly-portal`. To pozwala uniknąć ograniczeń macOS dotyczących usług uruchamianych z katalogu Dokumenty. Usługi aplikacji `local.vanly.portal.*` startują po zalogowaniu użytkownika. Uruchamianie aplikacji nie tworzy osobnego procesu preview ani proxy.

Starsze usługi `local.vanly.web` i `local.vanly.api`, wskazujące poprzednią instalację Vanly na dysku zewnętrznym, są wyłączone w launchd. Zapobiega to przejmowaniu portów 3100/4100 podczas aktualizacji. Ich pliki konfiguracyjne zachowano; działają usługi `local.vanly.portal.*`.

```sh
/Users/wojtek/.local/share/vanly-portal/vanly status
/Users/wojtek/.local/share/vanly-portal/vanly start
/Users/wojtek/.local/share/vanly-portal/vanly stop
```

Dawny adres podglądu `http://127.0.0.1:8181` obsługuje systemowy Nginx; panele aplikacji nadal mają porty 8182/8183. Polecenie preview jedynie wskazuje istniejące wejścia, bez uruchamiania kolejnego serwera.

Docelowe adresy: `https://vanly.me.local`, `https://owner.vanly.me.local`, `https://admin.vanly.me.local`. Instalacja usługi systemowej wymaga administratora macOS. Po jej zakończeniu istniejący skrypt sprawdza trasy Nginx:

```sh
/bin/sh '/Users/wojtek/.local/share/vanly-portal/ops/install-portal.sh'
```

Istniejący skrót `Uruchom portal HTTPS.command` wykonuje kontrolę wspólnego Nginx. Skrypt nie odtwarza dawnych konfiguracji proxy. Na innych urządzeniach należy zaufać publicznemu certyfikatowi: `http://vanly.me.local/.well-known/vanly/`. CA jest zachowywany w `/Library/Application Support/Vanly/tls/ca`, a punkt odzyskiwania `/Library/Application Support/Vanly/nginx-backups/latest` będzie zawierał wyłącznie Nginx. Mac musi być włączony, użytkownik zalogowany, urządzenia w głównej sieci `192.168.188.0/24`. Dostęp z fizycznie drugiego urządzenia wymaga osobnego sprawdzenia.

Nowe wydanie: `./scripts/deploy-local.sh`. Kopia danych: `./vanly backup`. Konta lokalne: `.local/Konta-lokalne.md` (plik prywatny).

## Testy

`./vanly test` — testy API i identyfikatorów żądań; wyłącznie baza `vanly_test`.

`./vanly test-browser` — portal, katalog, oferta, oba osobne panele, logowanie, wylogowanie i układ mobilny. Zrzuty: `output/verification`.

## SEO portalu docelowego

Publiczne sekcje, oferty i artykuły są renderowane z anonimowych danych API już w odpowiedzi HTML. Sprawdzenie sesji nie blokuje ich treści; operacje rezerwacji nadal czekają na sesję i token CSRF. Każdy publiczny adres ma własny tytuł, opis i canonical. Strona główna opisuje markę przez dane `WebSite`, a podstrony mają breadcrumbs; artykuły korzystają z danych `Article` i rzeczywistej daty aktualizacji.

Lokalna instalacja pozostaje wyłączona z indeksowania. `NODE_ENV=production` oznacza tryb uruchomienia Next.js i nie włącza indeksowania. Konfiguracja w głównym `.env.local`:

```dotenv
SEO_SITE_URL=https://vanly.me
SEO_INDEXING_ENABLED=false
SEO_API_INTERNAL_URL=http://127.0.0.1:4100/api/v1
```

Przy publikacji pełnego portalu ustaw `SEO_INDEXING_ENABLED=true` w jego środowisku. `/robots.txt` i `/sitemap.xml` są prawdziwymi odpowiedziami tekst/XML. Publiczna sitemapa obejmuje opublikowane oferty zweryfikowanych firm i opublikowane artykuły, bez limitu 100 wyników wyszukiwarki. Nie obejmuje kont, logowania, rezerwacji ani adresów z filtrami. Prywatne strony mają `noindex`; filtrowane wyniki wyszukiwania wskazują canonical `/pojazdy` i nie są indeksowane. Nieistniejące strony, oferty i artykuły zwracają 404, a awaria API nie jest przedstawiana jako nieistniejąca oferta.

Kandydaci do linków pod głównym wynikiem Google to istniejące sekcje: Kampery i przyczepy (`/pojazdy`), Kempingi (`/kempingi`), Poradniki (`/poradniki`), Odkrywaj (`/odkrywaj`) i Dla wypożyczalni (`/dla-firm`). Google wybiera sitelinki, ich kolejność i opisy automatycznie; znaczniki SEO nie narzucają tego układu. Dokumentacja: https://developers.google.com/search/docs/appearance/sitelinks.

Po publikacji zweryfikuj domenę w Google Search Console, zgłoś `https://vanly.me/sitemap.xml` i sprawdź stronę główną oraz przykładową ofertę i poradnik przez kontrolę adresu URL. Przed włączeniem indeksowania zastąp dane demonstracyjne rzeczywistymi ofertami i przygotuj środowisko produkcyjne; ten zakres przygotowuje SEO, nie publikuje portalu.

Kontrola SEO po buildzie: uruchom `./vanly test-seo`. Test używa osobnych procesów Next.js na 3102/3103 i API w pamięci, bez bazy ani zmiany działającego portalu. Sprawdza także zachowanie danych podczas hydratacji i zmian filtrów.

## Zakres i granice

Publiczna zapowiedź startu 15 października 2026 znajduje się w `apps/coming-soon/`. Jej oddzielna konfiguracja AWS dla `vanly.me`, stan publikacji i instrukcja aktualizacji są opisane w `infra/coming-soon/README.md`. Strona zapowiedzi nie łączy się z lokalnym API ani bazą portalu.

Działają lokalne konta, katalog, ceny, rezerwacje, dodatki, magazyn, flota, kalendarz, protokoły, wiadomości, moderacja, artykuły i kolejka. Płatności i kaucje są jawnie testowe. Ubezpieczenia, winiety, Stripe Connect, Autopay, S3, Sanity i wysyłka do partnerów wymagają danych i konfiguracji operatorów; nie są aktywne. Google Maps wymaga dopisania nowych adresów do listy dozwolonych witryn istniejącego klucza.

To lokalna implementacja funkcjonalnego portalu, a nie ukończone wdrożenie całej architektury produkcyjnej: brak czterech VM, PostGIS, RLS, produkcyjnego ledger/webhook inbox, zewnętrznych integracji, dzierżaw dla zadań sieciowych i backupu WAL poza komputerem. Kontrolery istniejących modułów wymagają dalszego rozdzielenia use-case/repository przed wdrożeniem produkcyjnym. Obecny worker realizuje wyłącznie krótkie lokalne zadania atomowo z SKIP LOCKED, bez sieci zewnętrznej.

Migracja Fastify korzysta z oficjalnych instrukcji: https://docs.nestjs.com/techniques/performance. Konfiguracja lokalnego proxy jest utrzymywana przez systemowy Nginx w `/Library/Application Support/LocalNginx`.
