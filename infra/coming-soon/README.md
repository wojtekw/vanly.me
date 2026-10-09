# Zaślepka vanly.me — infrastruktura i publikacja

Strona zapowiada start 20 października 2026. Jej pliki znajdują się w `apps/coming-soon/`. Statyczna zaślepka jest opublikowana pod `https://vanly.me/` i `https://www.vanly.me/` oraz potwierdzona testami HTTP i TLS. Konfiguracja CloudFront zakończyła wdrażanie. **Propagacja DNS jeszcze trwa**; nie wszystkie resolvery i przeglądarki widzą nowy adres. Lokalne aplikacje, API, bazy danych, płatności i worker nie są objęte wdrożeniem.

## Faktyczny sposób wdrożenia

Zasoby utworzono przez zalogowaną konsolę AWS na koncie `434793037720`; domeną zarządza się w GoDaddy. Upload 10 plików zaślepki (około 1,82 MiB) zakończył się wynikiem 100%. Delegacja z GoDaddy do Route53 została zapisana i potwierdzona niezależnie publicznym DNS. Dystrybucja `E1ESNDGM3WTQP4` korzysta z prywatnego S3 przez OAC `E3DZ1Y03D546EH` i ma zapisany root object `index.html`. Manage Plan pokazuje bieżący plan Free 0 USD oraz przypiętą strefę `vanly.me` (`Z075191742DMTSFOW6RO`, dostępna akcja Detach). ARN subskrypcji nie jest widoczny na sprawdzonej stronie; nie został wymyślony ani uzyskany przez profil o niewystarczających uprawnieniach. Jeden certyfikat ACM dla obu nazw osiągnął `ISSUED`; walidacja obu domen ma `Success`. `console-state.json` przechowuje faktyczny stan i źródła potwierdzeń.

`cloudformation.yaml` jest wyłącznie referencją konfiguracji przyszłego, osobnego wdrożenia, **nie wdrożonym stosem ani importem obecnych zasobów**. Nie uruchamiać go nad istniejącymi zasobami: powstałby drugi bucket i druga dystrybucja. Przy przejściu na IaC należy najpierw uzgodnić import/adopcję zasobów i dostosować nazwę oraz region istniejącego bucketa. Referencyjny stos używa `us-east-1` ze względu na WAF globalny i wymagany region certyfikatu ACM dla CloudFront; faktyczny bucket zaślepki znajduje się w `eu-central-1`.

Potwierdzone zasoby:

| Element | Konfiguracja |
| --- | --- |
| Domena | `vanly.me` zarejestrowana w GoDaddy; `www.vanly.me` jest drugą opublikowaną nazwą strony |
| S3 | `vanly-me-coming-soon-434793037720`, `eu-central-1` |
| S3 dostęp | Prywatny, blokada dostępu publicznego, ACL wyłączone, SSE-S3, wersjonowanie |
| Route53 | Publiczna strefa `Z075191742DMTSFOW6RO` dla `vanly.me` |
| DNS | Delegacja Route53, CNAME ACM i A/AAAA obu nazw do CloudFront potwierdzone; część resolverów ma jeszcze poprzednie rekordy |
| CloudFront | `E1ESNDGM3WTQP4`, `d3efg33xz921lx.cloudfront.net`, bieżący Free 0 USD, OAC `E3DZ1Y03D546EH`, HTTPS, strefa przypięta do planu; wdrażanie zakończone, potwierdzone po odświeżeniu konsoli |
| ACM | `0f46224c-64b2-420a-a410-f8681055328e`, `us-east-1`; `ISSUED`, oba CNAME potwierdzone publicznie, walidacja obu domen `Success` |

W nowej strefie zachowano `_dmarc` TXT i `_domainconnect` CNAME. W GoDaddy DNSSEC jest wyłączony. Po wznowieniu połączenia z przeglądarką GoDaddy potwierdziło zapis czterech nameserverów AWS. Google i Cloudflare DNS-over-HTTPS niezależnie zwracają `ns-175.awsdns-21.com`, `ns-1836.awsdns-37.co.uk`, `ns-830.awsdns-39.net`, `ns-1384.awsdns-45.org` oraz oba dokładne CNAME dla ACM. Rekordy walidacyjne zapisano w `console-state.json`; wyniki odczytu w `public-dns-observation.json`. `godaddy-dns-before.json` dokumentuje wszystkie siedem wcześniej widocznych rekordów i pełne wartości TXT `_dmarc` oraz CNAME `_domainconnect`, **nie pełny eksport strefy**. Pobranie eksportu w UI nie zostało zakończone; pełne SOA pozostaje `null`, a A `@` zachowuje label `Parked` i oddzielnie odczytane IPv4. Nie używać pliku obserwacji jako gotowej paczki do odtworzenia DNS.

## Koszt i limit 50 USD całego konta

Według oficjalnego cennika sprawdzonego 30 września 2026, plan CloudFront Free kosztuje **0 USD/miesiąc**, obejmuje bazowo 1 mln żądań i 100 GB transferu; CloudFront nie nalicza dopłat za przekroczenie. Przy dużym lub trwałym przekroczeniu AWS może zmienić sposób obsługi ruchu. Plan Pro kosztuje 15 USD/miesiąc. Automatyczne przejście na płatny plan nie jest częścią konfiguracji. [Cennik AWS](https://aws.amazon.com/cloudfront/pricing/).

Free obejmuje CloudFront, przypisany WAF, podstawowe koszty podłączonej strefy Route53 oraz kredyt na 5 GB S3 Standard. Strefę trzeba rzeczywiście przypiąć do subskrypcji; samo utworzenie jej w tym samym koncie nie wystarcza. Dla ALIAS do CloudFront zapytania DNS są objęte bez limitu, a pozostałe typy mają 1 mln zapytań miesięcznie. Przy ich przekroczeniu AWS może przenieść strefę na rozliczanie za użycie. [Zakres planu i DNS](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html).

**Free nie tworzy twardego limitu wydatków całego konta AWS.** S3 PUT/GET/LIST oraz inne operacje nie są kredytem na przechowywanie i pozostają rozliczane według użycia. Inne istniejące usługi konta, przechowywanie/odpytywanie logów, rejestracja/odnowienie domeny i nieobjęte funkcje są osobnymi kosztami. Minimalna statyczna strona z długim cache ogranicza zapytania do S3; nie stanowi gwarancji zerowego rachunku. [Cennik S3](https://aws.amazon.com/s3/pricing/).

Kontrola budżetu 50 USD dotyczy sumy usług na koncie. Dashboard AWS sprawdzony 30 września 2026 pokazał dla września **10,75 USD dotychczas i 11 USD prognozy**, dla poprzedniego miesiąca **13,31 USD** oraz **dwa istniejące budżety**. W AWS Budgets potwierdzono `Account monthly limit 50 USD`: kwota 50 USD, stan `Healthy` / `OK`, wydatki 10,75 USD i prognoza 11 USD. Drugi, `My Zero-Spend Budget` z kwotą 1 USD, jest przekroczony. Budżetów nie zmieniano. Adresaci powiadomień nie zostali sprawdzeni; UI ostrzega `Email verification required`, więc subskrybenci muszą zweryfikować adres, zanim otrzymają powiadomienia. Są to wartości odczytane w konsoli, nie gwarancja przyszłego rachunku. Alert kosztowy informuje o progu, **nie zatrzymuje automatycznie wydatków**. Nie tworzyć EC2, RDS, NAT Gateway, płatnych endpointów ani nowego stosu do obsługi zaślepki.

Plan Free ma maksymalnie trzy subskrypcje na konto i nie jest dostępny dla kont działających wyłącznie w nowym trybie AWS Free Tier. Przed aktywacją ruchu należy potwierdzić stan `ACTIVE` i tier `FREE`. [Warunki konta](https://docs.aws.amazon.com/PricingPlanManager/latest/UserGuide/plans.html).

## Narzędzia do istniejącego wdrożenia

`deploy.py` nie tworzy zasobów, nie zmienia IAM ani DNS. Działa na identyfikatorach jawnie podanych w pliku celu i tylko na zweryfikowanym koncie. Domyślny manifest jest lokalny. Polecenia `verify`, `publish` i `rollback` wymagają uprawnień do wskazanych zasobów; obecny profil `vectra26-deploy` pozwolił na odczyt tożsamości, lecz odrzucił odczyty S3, CloudFront, ACM i Route53. Jego uprawnień nie zmieniano. **Bieżące utrzymanie odbywa się przez konsolę**, do czasu uzyskania rzeczywistego ARN subskrypcji oraz już uprawnionego profilu. Zestaw narzędzi SDK jest przygotowany do przyszłego użycia; nie stanowi potwierdzenia obecnego dostępu.

### Analityka — publikacja i pomiary potwierdzone

W Google Analytics przez Chrome utworzono konto/usługę/strumień z następującymi identyfikatorami przekazanymi z konsoli: konto `10875208`, usługa `556850726` o nazwie `VANLY—vanly.me`, strumień `15890613646` dla `https://vanly.me`, rzeczywisty Measurement ID **`G-6P7XHCK7L7`**. Potwierdzone ustawienia: Enhanced Measurement wyłączone, redakcja adresów e-mail włączona, liczba połączonych tagów witryny 0. Dodatkowe signals i zbieranie danych podanych przez użytkownika wyłączone; personalizacja reklam wyłączona dla wszystkich 307 regionów (0 aktywnych). Retencja danych użytkowników i zdarzeń wynosi po 2 miesiące, reset retencji przy nowej aktywności wyłączony. Ustawienia zostały zapisane i sprawdzone w UI przez głównego agenta.

Wariant wykorzystuje `analytics.js` i zgodę odwiedzającego przed uruchomieniem pomiaru. Upload trzech plików przez konsolę zakończył się wynikiem 100%: HTML 4801 B, CSS 8598 B, JavaScript 8846 B, łącznie 22245 B. Wszystkie trzy mają `Cache-Control: public, max-age=300`. G-ID jest już widoczny w publicznym HTML na obu domenach i hoście CDN, a treści plików pasują SHA-256 do lokalnych źródeł.

Oba invalidation zakończyły się stanem `Completed`: `I3U1AASXTMVS9EXGXRYKRQP8QG` dla `/*`, utworzone **30 września 2026 o 14:35:23 UTC (16:35:23 w Warszawie)**, oraz `IB2FN59BNS7N496L3S6HD6Y3OM` dla `/analytics.js`, utworzone o **14:38:58 UTC (16:38:58 w Warszawie)**. Drugi stan `Completed` potwierdzono w konsoli około 14:40 UTC. Skrypt ponownie przesłano z jawnym `Content-Type: text/javascript; charset=utf-8` i zachowano cache 300 s. Końcowa kontrola publiczna o **14:39:09 UTC** przeszła **9/9**: wszystkie trzy pliki na obu domenach i hoście CDN mają prawidłowy status HTTPS, identyczne SHA-256, uzgodniony MIME i właściwy G-ID. Kryteriów kontroli nie poluzowano.

**GA4 odbiera rzeczywiste dane:** główny agent potwierdził w Realtime usługi `556850726` jednego aktywnego użytkownika, `page_view: 1` dla tytułu `VANLY — start 15 października 2026` oraz `first_visit: 1` i `session_start: 1`. Nie przypisano tej wizyty konkretnej osobie ani źródłu; główny agent nie symulował wizyty produkcyjnej. Kontrola plików nie wykonuje JavaScript i nie wysyła zdarzeń GA, więc nie jest źródłem tego pomiaru. Dowody UI: `.local/qa/vanly-ga4-realtime.jpg` oraz bardziej szczegółowy `.local/qa/vanly-ga4-page-view.jpg` z tytułem strony i zdarzeniami.

Lokalne testy zgody i współdzielonego cookie przeszły **32/32** według raportu workera. Kontrola statycznej kopii w przeglądarce przeszła desktop i mobile 390 px. **Zachowanie zgody w przeglądarce na produkcyjnej domenie pozostaje niesprawdzone**, ponieważ Chrome nadal pokazał alert SSL dla własnej domeny; nie obchodzono tej kontroli. Nie przedstawiać lokalnej/statycznej kontroli lub samego Realtime jako testu tego konkretnego zachowania w produkcji. Projekt analityki i jego testy należą do plików aplikacji; ten pakiet odpowiada za dokumentację i sprawdzanie opublikowanych plików.

Końcowy manifest obejmuje 11 plików, 1 917 203 B, SHA-256 `6c6d106f90a6891ed69638a235847b992bdcf4eaf99fd89f04a012f4e73a08da`. Dowody: `.local/qa/vanly-analytics-upload.jpg`, `.local/qa/vanly-analytics-invalidation.jpg`, `.local/qa/vanly-ga4-realtime.jpg`, `.local/qa/vanly-ga4-page-view.jpg`. Jawne podsumowanie: `analytics-verification-summary.json`; pełny odczyt plików: `.local/coming-soon/analytics-public-verification.json`. Dokumentacja implementacji i zgody: `docs/coming-soon-analytics.md`.

MIME pliku skryptu ma być `text/javascript` (publisher ustawia jawnie `text/javascript; charset=utf-8`). Nie podłączać dodatkowego skryptu Google przed spełnieniem warunku zgody przewidzianego w implementacji. Gdy Chrome uzyska prawidłowe połączenie z domeną, uzupełnić brakujący test przeglądarkowy stanu bez zgody i po zgodzie na produkcyjnej stronie. Nie przedstawiać samego uploadu plików lub utworzenia usługi jako potwierdzenia odbioru danych przez Google Analytics.

Lokalny manifest (bez połączenia z AWS):

```sh
python3 infra/coming-soon/deploy.py manifest
```

Kontrola plików po zakończeniu uploadu i invalidation; ostatni wynik 9/9:

```sh
python3 infra/coming-soon/check_public.py --measurement-id G-6P7XHCK7L7
```

`check_public.py` porównuje trzy zmienione pliki na obu domenach i publicznym hoście CloudFront z bieżącymi lokalnymi SHA-256, sprawdza status 200, MIME oraz pojedynczy właściwy G-ID w HTML. Używa standardowej weryfikacji TLS i systemowego rozwiązywania nazw, bez override IP i bez podążania za przekierowaniami. Nie wykonuje JavaScript, nie kontaktuje się z Google Analytics i nie wysyła pomiarów. Wynik zapisuje do `.local/coming-soon/analytics-public-verification.json`. Jest to kontrola publikacji plików, a nie działania zgody lub odbioru danych przez GA4.

Ostatnia kontrola dostępności środowiska nadal pokazuje tylko profil `vectra26-deploy`, brak zmiennych uwierzytelniających AWS i brak CLI w PATH. Nie znaleziono nowego, potwierdzonego dostępu do publikacji. Nie rozszerzano IAM. Ręczne utrzymanie konsolą pozostaje bieżącą ścieżką.

Izolowane zależności są w `.local/aws-tooling-venv/`; pliki stanu i poprzednich wersji zapisują się do `.local/coming-soon/`, poza repozytorium. Do przyszłej pracy z już uprawnionym profilem:

```sh
python3 -m venv .local/aws-tooling-venv
.local/aws-tooling-venv/bin/python -m pip install -r infra/coming-soon/requirements.txt
cp infra/coming-soon/target.example.json .local/coming-soon-target.json
```

ID dystrybucji, strefy i ARN certyfikatu `ISSUED` są już zapisane w `target.example.json`. **ARN subskrypcji pozostaje nieznany:** przed użyciem `verify`, `publish` lub `rollback` przez SDK trzeba uzupełnić go rzeczywistą wartością dostępną dla uprawnionej tożsamości. Obecny przykład zawiera jawny znacznik do zastąpienia, więc nie jest jeszcze gotowym plikiem celu dla publishera. Potwierdzenie Free i przypięcia strefy pochodzi z Manage Plan w konsoli. Nie dopisywać do pliku kluczy dostępu. Zasoby zostały stworzone konsolą; nie wdrożono osobnego stosu CloudFormation.

```sh
# Bez połączenia z AWS: lista plików, rozmiary, sumy SHA-256.
.local/aws-tooling-venv/bin/python infra/coming-soon/deploy.py manifest

# Wyłącznie odczyt; nazwa profilu musi być wybrana jawnie.
.local/aws-tooling-venv/bin/python infra/coming-soon/deploy.py verify --target .local/coming-soon-target.json --profile vanly-authorized

# Publikacja na istniejący bucket po pełnej kontroli FREE/OAC/ACM/DNS.
.local/aws-tooling-venv/bin/python infra/coming-soon/deploy.py publish --target .local/coming-soon-target.json --profile vanly-authorized
```

`vanly-authorized` to przykładowa nazwa profilu z prawidłowymi uprawnieniami, nie istniejący profil. Alternatywnie można wybrać `--use-environment` z już skonfigurowanym łańcuchem uwierzytelniania. Nie pobierać sesji/kluczy z przeglądarki.

Publisher odrzuca ukryte pliki i symlinki oraz paczki przekraczające 200 plików lub 20 MiB. Obsługuje `.js` z jawnym MIME `text/javascript`, lokalne fonty `.ttf`, `.woff` i `.woff2`, zachowuje plik licencji fontu i jawnie pomija źródłowy `README.md`. Nie przesyła aplikacji ani `.env`. Sprawdza m.in. prywatność i wersjonowanie S3, dwie nazwy domen, OAC, certyfikat `ISSUED`, subskrypcję `ACTIVE FREE` oraz przypisanie WAF i strefy do planu. Zapisuje wersje wcześniejszych obiektów, przesyła tylko pliki o zmienionym SHA-256, plik `index.html` na końcu, następnie odświeża cache. Ponowienie nie dodaje nowych wersji niezmienionych plików. Obiekty, których nie ma w paczce, nie są automatycznie usuwane.

Przed uruchomieniem publishera istniejący bucket musi mieć wersjonowanie. Infrastruktura referencyjna zachowuje wcześniejsze wersje przez 30 dni i pozostawia bucket przy usunięciu stosu. Konsolowy bucket ma osobną konfigurację; nie zakładać automatycznie, że ten sam lifecycle już w nim działa.

## Wycofanie

Jeżeli publikację wykonano narzędziem, odpowiedź zawiera dokładną ścieżkę `rollbackRecord`. Przywrócenie wcześniejszych wersji:

```sh
.local/aws-tooling-venv/bin/python infra/coming-soon/deploy.py rollback --target .local/coming-soon-target.json --profile vanly-authorized --record .local/coming-soon/release-DOKLADNA_NAZWA.json
```

Wycofanie przywraca wcześniejsze wersje tylko zapisanych, zmienionych obiektów, a nowe pliki ukrywa znacznikami usunięcia; następnie odświeża cache. Nie usuwa historii wersji.

Po publikacji konsolowej należy użyć wersjonowania S3: skopiować wcześniejsze wersje zmienionych plików jako aktualne i unieważnić `/*` w CloudFront. Pierwsza publikacja nie ma wcześniejszej wersji strony.

Wycofanie DNS wymaga uprzednio zachowanych pełnych rekordów GoDaddy. Przywrócić poprzednie serwery `ns39.domaincontrol.com`, `ns40.domaincontrol.com` dopiero po potwierdzeniu, że stare rekordy nadal istnieją i prowadzą do działającego celu. Propagacja nie jest natychmiastowa. Nie usuwać nowej strefy, certyfikatu ani dystrybucji w czasie propagacji. Przy wycofaniu całej infrastruktury najpierw wyłączyć ruch, potwierdzić DNS, następnie anulować Free plan przed usunięciem dystrybucji; pozostawione WAF/strefa po anulowaniu planu wracają do osobnego rozliczania. [Anulowanie i usuwanie planu](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html).

## Weryfikacja

Kontrola pierwszego opublikowanego wariantu, **przed przygotowywaną zmianą analityki**, potwierdziła przez `requests` oraz `curl` bez nadpisania DNS oba adresy HTTPS: status 200 i prawidłową weryfikację TLS; HTTP obu nazw zwracało 301 do HTTPS. Wszystkie 10 plików na każdej domenie oraz root `cloudfront.net` przeszły kontrolę SHA-256 i MIME (21/21). Dotyczy to również HTML, CSS i lokalnego fontu `font/ttf`. Bezpośredni, nieuwierzytelniony odczyt `index.html` z regionalnego endpointu S3 zwracał 403 `AccessDenied` w obu narzędziach. Raport ten nie jest weryfikacją późniejszych lokalnych zmian `analytics.js`.

Źródłem rozwiązania nazw dla HTTP jest domyślne sieciowanie systemowe (`socket.getaddrinfo`), bez własnego resolvera, przypinania IP, wpisów publicznej domeny w `/etc/hosts` ani środowiskowego proxy. Domyślne `curl` łączyło się z `3.174.230.112` dla apex i `3.174.230.91` dla www, `ssl_verify_result=0`. Odczyty DNS wykonane osobno przez Google i Cloudflare DNS-over-HTTPS pokazują propagację: Cloudflare zwraca A i AAAA CloudFront obu nazw, Google zachowuje część starego/negatywnego cache. Również `dig` do routera `192.168.188.1` pokazuje poprzednie rekordy GoDaddy, chociaż systemowe rozwiązanie nazw dla HTTP zwraca już adresy CloudFront. Nie należy utożsamiać tych odczytów ani deklarować zakończonej propagacji we wszystkich resolverach.

Przeglądarka Chrome głównego agenta przy świeżym odczycie `https://vanly.me/` pokazała `ERR_SSL_UNRECOGNIZED_NAME_ALERT`. Przyczyna nie została ostatecznie rozstrzygnięta; różne warstwy cache DNS są możliwym wyjaśnieniem, podczas gdy testy HTTP/TLS zwracają poprawną stronę. CloudFront zakończył już wdrażanie, potwierdzone odświeżeniem konsoli: zamiast `Deploying` widoczna jest data Last modified `2026-09-30 14:03:01 UTC` (kadr `.local/qa/aws-coming-soon-deployed.jpg`). Publiczny adres `https://d3efg33xz921lx.cloudfront.net/` przeszedł kontrolę przeglądarkową desktop i mobile 390 px: font załadowany, obrazy kompletne, brak błędów/ostrzeżeń oraz przewijania poziomego na mobile. Kadry głównego agenta zapisano jako `.local/qa/coming-soon-live-desktop.jpg` i `.local/qa/coming-soon-live-mobile.jpg`. Nie obchodzono kontroli certyfikatu przy weryfikacji domeny.

Pełny raport i źródła DNS: `.local/coming-soon/public-web-verification.json`; jawne podsumowanie: `verification-summary.json`. Projekt strony przeszedł wcześniej lokalną kontrolę desktop/mobile i klawiatury; nie przedstawiać tego ani kontroli publicznego hosta CDN jako dowodu zakończonej kontroli własnej domeny w każdej przeglądarce.

Po zakończeniu propagacji ponownie sprawdzić Chrome i A/AAAA obu nazw w resolverach, które zachowały poprzednie rekordy. Nie uznawać samego zakończenia kreatora ani lokalnego manifestu za dowód publikacji.

Testy narzędzi działające bez AWS:

```sh
python3 -m unittest discover -s infra/coming-soon -p 'test_*.py'
```

API aplikacji nie było zmieniane przez ten pakiet. Główny agent wykonał dodatkowo wymagane przez repozytorium `./vanly test`: 19/19 testów przeszło pomyślnie w odizolowanej bazie `vanly_test`.
