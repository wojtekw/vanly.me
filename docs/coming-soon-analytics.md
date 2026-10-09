# Analityka zaślepki VANLY

Zaślepka korzysta z bezpośredniego Google tag (`gtag.js`) dla GA4. Nie wymaga Google Tag Manager, innych trackerów ani nowych zasobów AWS. Publiczny identyfikator strumienia jest jednym polem w `apps/coming-soon/index.html`:

```html
<meta name="ga4-measurement-id" content="G-6P7XHCK7L7">
```

Skonfigurowany identyfikator `G-6P7XHCK7L7` należy do strumienia WWW VANLY `15890613646`. Identyfikator pomiaru nie jest sekretem. Puste pole i błędny identyfikator całkowicie wyłączają integrację. Nie podstawiaj identyfikatora z innego projektu.

## Konfiguracja GA4

- Strumień WWW dla `https://vanly.me/`, strefa raportowania zgodna z Polską.
- **Enhanced measurement wyłączone**. Ta zaślepka wysyła ręcznie jedno `page_view` na wizytę po zgodzie. Dodatkowe automatyczne zdarzenia nie są potrzebne i mogą przesyłać pełne adresy linków.
- Google signals i zbieranie danych podanych przez użytkowników wyłączone w usłudze. Personalizacja reklam jest wyłączona dla wszystkich 307 regionów (0 włączonych). Kod stale odmawia `ad_storage`, `ad_user_data` i `ad_personalization`, a konfiguracja używa `allow_google_signals: false` oraz `allow_ad_personalization_signals: false`. Brak integracji z produktami reklamowymi.
- Redakcja adresów e-mail w strumieniu włączona jako dodatkowe zabezpieczenie. Retencja danych zdarzeń i użytkowników ustawiona na dwa miesiące.
- GA4 Enhanced measurement i inne ustawienia konta są konfiguracją po stronie Google. Sam kod strony nie zastępuje ich ustawienia w panelu.

## Zachowanie zgody

`analytics.js` działa tylko na `vanly.me` i `www.vanly.me`. Podgląd lokalny oraz domena CloudFront pozostają bez analityki i panelu zgody. Panel pojawia się po raz pierwszy na domenie produkcyjnej, ma dwa jednakowe wizualnie przyciski: „Odrzuć” i „Zgadzam się”. Przycisk „Ustawienia prywatności” w stopce pozwala zmienić decyzję.

Przed zgodą oraz po odmowie nie jest pobierany Google tag i nie są wysyłane żadne żądania analityczne, także sygnały bez cookie. Jest to **basic consent mode**. Zgoda oraz odmowa są zapamiętywane we własnej cookie `vanly_analytics_consent_v1` z `Domain=vanly.me`, `Path=/`, `Secure`, `SameSite=Lax`. Ta cookie służy wyłącznie zapamiętaniu ustawień prywatności i jest wspólna dla vanly.me oraz www.vanly.me. Dzięki temu wycofanie na www nie przywraca starej zgody po przejściu na główny adres.

Pamięć trwa najwyżej sześć miesięcy kalendarzowych. Koniec miesiąca jest przycinany do ostatniego istniejącego dnia miesiąca docelowego, np. 31 sierpnia → 28 lutego. Wartość jest wersjonowana i zawiera wybór, czas zapisu oraz termin wygaśnięcia. Uszkodzony, przeterminowany lub nieznany zapis nie uruchamia analityki. Cookie jest jedyną trwałą podstawą przywrócenia zgody. Stary zapis `granted` w localStorage bez cookie nigdy nie uruchamia GA4 i nie jest migrowany.

`localStorage` pod kluczem `vanly.analytics-consent.v1` służy jedynie jako sygnał zmiany dla otwartych kart tego samego origin; po sygnale kod ponownie odczytuje cookie. Blokada localStorage i brak miejsca w nim nie wpływają na wspólną cookie. Gdy przeglądarka blokuje samą cookie, świadomy wybór działa w bieżącej wizycie, a kolejna wizyta nie przywraca zgody automatycznie.

Po zgodzie ładowany jest jeden skrypt `https://www.googletagmanager.com/gtag/js?id=G-…`. `send_page_view: false` zapobiega automatycznej duplikacji. Następnie wysyłane jest jedno ręczne `page_view`. Ponowne kliknięcie zgody podczas tej samej wizyty nie dodaje skryptu ani kolejnego zdarzenia.

Zdarzenie zawiera tytuł statycznej strony, `page_location` z origin i ścieżką **bez query i hash**, oraz `page_referrer` ograniczone do origin. Nie przesyłamy parametrów UTM, treści URL linków, identyfikatorów użytkownika, danych formularzy, nazwisk ani adresów e-mail. Pomiar nie zawiera dodatkowych własnych zdarzeń. Ograniczenie query zmniejsza szczegółowość atrybucji kampanii.

Wycofanie zgody ustawia `ga-disable-G-…` **przed** aktualizacją odmowy, usuwa cookie `_ga`, `_ga_<ID>` i odpowiadające `_gat_gtag_<ID>` w wariantach domeny oraz zapisuje wspólną odmowę. Jeśli tag był już ładowany, odświeżenie strony usuwa bibliotekę Google i jej zdarzenia. Kolejna wizyta odczytuje odmowę i nie ładuje tagu. Zmiana w drugiej karcie tego samego origin jest synchronizowana przez storage event. Karta na drugim hostcie ponownie odczytuje cookie przy uzyskaniu fokusu, powrocie do widoczności, `pageshow` oraz podczas aktywnego pomiaru raz na sekundę. Wycofanie w tej karcie blokuje pomiar przed odświeżeniem. Jeśli cookie stała się niezapisywalna i nadal zawiera starszą zgodę, kod pozostawia pomiar wyłączony w bieżącej karcie i nie odświeża jej do starej zgody.

Informacja w panelu wyjaśnia użycie Google Analytics i cookie oraz odsyła do opisu przetwarzania danych przez Google. Nie dodano niezweryfikowanych danych prawnych administratora. Ewentualna pełna polityka prywatności wymaga rzeczywistych danych właściciela serwisu i ustaleń dotyczących usługi GA4.

## Weryfikacja

Stan 30 września 2026: rzeczywista usługa **VANLY — vanly.me** (`556850726`) na koncie `10875208` jest skonfigurowana. Trzy pliki opublikowano przez konsolę AWS do istniejącego prywatnego bucketa; obie invalidations zakończyły się `Completed`. Kontrola publicznych plików na vanly.me, www.vanly.me i adresie CDN przeszła **9/9**: prawidłowe SHA-256, MIME i G-ID. Raport: `.local/coming-soon/analytics-public-verification.json`.

W [raporcie Realtime](https://analytics.google.com/analytics/web/#/a10875208p556850726/realtime/overview) zaobserwowano jednego aktywnego użytkownika, jedno `page_view` z tytułem „VANLY — start 15 października 2026”, a także `first_visit` i `session_start`. Nie ustalano tożsamości odwiedzającego i nie symulowano zdarzeń produkcyjnych. Potwierdzenie: `.local/qa/vanly-ga4-realtime.jpg`.

**32/32 testy zachowania zgody przeszły.** Panel sprawdzono wizualnie na lokalnej kopii z widocznym panelem: desktop i 390 px, równe przyciski wysokości 44 px, bez przewijania poziomego. Chrome głównego agenta nadal zwracał `ERR_SSL_UNRECOGNIZED_NAME_ALERT` na obu domenach po zmianie DNS, dlatego bezpośrednia kontrola kliknięć zgody w tej sesji produkcyjnej nie została ukończona. Nie obchodzono sprawdzania certyfikatu. Odbiór danych w Google i publiczne pliki z poprawną weryfikacją TLS są potwierdzone niezależnie; nie utożsamiać ich z pełną kontrolą panelu w każdej przeglądarce.

Uruchom z katalogu projektu:

```sh
/Users/wojtek/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/coming-soon-analytics.test.mjs
```

Testy jsdom przechwytują żądania i nie łączą się z Google. Sprawdzają brak tagu przed zgodą i po odmowie, pojedyncze zdarzenie po zgodzie i po zapamiętanej zgodzie, filtrację URL, trwały brak zgód reklamowych, usuwanie cookie przed odświeżeniem, wycofanie w innej karcie, uszkodzoną i wygasłą pamięć, brak localStorage, wyłączenie na lokalnym/CDN adresie oraz dostępność klawiaturową panelu. Wspólny CookieJar w testach dwóch hostów sprawdza zgodę na apex, jej odczyt na www, wycofanie na www, reakcję otwartej karty apex oraz brak ponownego uruchomienia przez starszy localStorage. Osobne przypadki sprawdzają blokadę cookie, końce miesięcy i parametry bezpieczeństwa cookie. Testy izolowane nie potwierdzają odbioru zdarzenia przez konto GA4; wymaga to sprawdzenia Realtime po publikacji na właściwej domenie i po świadomym wyrażeniu zgody.

Po publikacji sprawdź na czystej sesji produkcyjnej brak żądań do Google przed wyborem i po odmowie, odbiór `page_view` po zgodzie, a następnie wycofanie oraz brak tagu po odświeżeniu. Sprawdź panel na małym ekranie i desktopie oraz stopkę po zamknięciu panelu.

Źródła konfiguracji: [Consent mode — basic i advanced](https://developers.google.com/tag-platform/security/concepts/consent-mode), [wyłączenie pomiaru Google Analytics](https://developers.google.com/tag-platform/security/guides/privacy#turn_off_google_analytics), [parametry konfiguracji GA4](https://developers.google.com/analytics/devguides/collection/ga4/reference/config).
