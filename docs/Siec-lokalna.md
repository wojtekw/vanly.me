# Vanly w domowej sieci i HTTPS

Stan 05.10.2026: **konfiguracja Nginx jest przygotowana; instalacja trwa**. Portal i dawne wejścia preview obsługuje systemowa usługa `local.nginx.compat`, z plikami w `/Library/Application Support/LocalNginx`. Osobna usługa preview jest wyłączona. VANLY zachowuje standardowe adresy HTTP/HTTPS i dotychczasowy publiczny CA. Odbiór końcowy oraz próba z fizycznie drugiego urządzenia pozostają do wykonania. Google Maps przez HTTPS jest osobnym krokiem opisanym poniżej.

## Historia instalacji z 23.09.2026

Pierwsza próba ujawniła błąd formatu dwóch adresów (Ethernet + Wi-Fi); został poprawiony i zweryfikowany z rzeczywistym wynikiem wykrywania sieci. Druga próba zakończyła się `Bootstrap failed: 5: Input/output error` po poprawnej walidacji Caddy. Instalator odtworzył poprzednią konfigurację i Vanly działało na `127.0.0.2:80`. Zmieniono instalację i wycofanie: istniejąca definicja usługi jest teraz restartowana przez `launchctl kickstart -k`, bez sekwencji usuwania/rejestracji. Rzeczywisty test na osobnej tymczasowej usłudze użytkownika macOS przeszedł pierwsze uruchomienie, restart po podmianie skryptu i przywrócenie. Wynik instalacji oraz etap ewentualnej awarii zapisują się w `/Library/Application Support/Vanly/lan-install-status.txt`.

Trzecia próba zakończyła się powodzeniem. Plik stanu potwierdził HTTP, HTTPS i dodanie zaufania certyfikatowi; zostało to niezależnie sprawdzone po instalacji.

## Kontrola po instalacji Nginx

Po zakończeniu instalacji systemowej usługi sprawdź istniejące trasy portalu:

```sh
/bin/sh '/Users/wojtek/Documents/ChatGPT/Vanly.me/ops/install-portal.sh'
```

Istniejące skróty instalacyjne kierują do kontroli wspólnego Nginx. Nie uruchamiają osobnego procesu preview.

Po komunikacie o powodzeniu dostępne będą `http://vanly.local/` i `https://vanly.local/`. HTTP pozostaje dostępne podczas instalowania certyfikatów na innych urządzeniach. Nie ma automatycznego przekierowania ani HSTS. Do kont i rezerwacji preferuj HTTPS po dodaniu zaufania certyfikatowi.

Mac musi być włączony, użytkownik zalogowany (usługi aplikacji są LaunchAgents), dysk Extreme SSD podłączony. Nie zmieniono ustawień usypiania Maca.

## Sieć i FRITZ!Box

- Wykryty router: `192.168.188.1`, sieć `192.168.188.0/24`.
- Adresy Maca sprawdzone 05.10.2026: Ethernet `192.168.188.44`, Wi-Fi `192.168.188.45`; po zmianie DHCP wymagają ponownej kontroli.
- Docelowy Nginx nasłuchuje wyłącznie na `127.0.0.2` i adresach interfejsów en0/en1 należących do tej konkretnej sieci. Dodatkowo odrzuca klientów spoza loopback i `192.168.188.0/24`.
- HTTPS jest po TCP; nie włączamy HTTP/3 ani nasłuchu na publicznym IPv6 lub wszystkich interfejsach.
- Proces nadzorujący sprawdza adresy co 15 sekund. Po zmianie DHCP odtwarza nasłuch i ogłoszenie Bonjour; po opuszczeniu tej sieci pozostaje tylko loopback.
- Nazwa `vanly.local` jest ogłaszana przez mDNS/Bonjour na głównym interfejsie domowym (preferowany Ethernet). Nie zmieniamy nazwy Maca.
- Backend 4100, frontend 3100 i PostgreSQL 5432 pozostają na loopback. Do sieci trafiają wyłącznie wejścia HTTP/HTTPS przez Nginx.
- Nie zmieniono FRITZ!Box, przekierowania portów, UPnP ani zapory. Narzędzie przeglądarki odmówiło dostępu do panelu, ponieważ nie mogło sprawdzić polityki administratora. Nie obchodzono blokady.

Urządzenia muszą być w tej samej głównej sieci. Sieć gościnna i izolacja klientów mogą blokować zarówno Vanly, jak i Bonjour. Nazwa `.local` jest obsługiwana przez mDNS, więc FRITZ!Box nie musi przechowywać niestandardowego rekordu DNS. Działanie nazwy na konkretnych urządzeniach należy sprawdzić; starsze systemy, VPN i firmowe ustawienia mogą wyłączyć mDNS.

Awaryjnie można dodać do pliku hosts **na urządzeniu klienckim** wpis `192.168.188.44 vanly.local`. Wtedy warto zarezerwować ten adres w FRITZ!Box: Sieć domowa → Sieć → edycja Maca → zawsze ten sam IPv4. Rezerwacja nie została jeszcze wykonana. Wpis hosts nie aktualizuje się po zmianie DHCP; Bonjour aktualizuje się automatycznie. Na samym serwerze zachowano istniejące `127.0.0.2 vanly.local`, żeby inne lokalne projekty nadal miały swoje adresy.

## Certyfikat

Nginx używa certyfikatów dotychczasowego urzędu „Vanly Local”. Skrypt odnowienia korzysta z CA przenoszonego do `/Library/Application Support/Vanly/tls/ca`; klucz serwera pozostaje w `/Library/Application Support/Vanly/tls`. Prywatne klucze są dostępne wyłącznie dla root. Plik udostępniany klientom to **wyłącznie publiczny certyfikat główny**, bez klucza prywatnego.

Instalator dodaje na serwerze zaufanie SSL ograniczone do nazwy `vanly.local`. Pozostałe urządzenia wymagają jednorazowej instalacji certyfikatu. Otwórz na nich:

`http://vanly.local/.well-known/vanly/`

Pobierz `vanly-root.crt`, porównaj jego odcisk SHA-256 z odciskiem wypisanym przez instalator na Macu, a następnie:

- **macOS:** Dostęp do pęku kluczy → import do System → szczegóły certyfikatu → Zaufanie → SSL: Zawsze ufaj. Potwierdź hasłem administratora.
- **Windows:** otwórz plik → Zainstaluj certyfikat → Bieżący użytkownik → Zaufane główne urzędy certyfikacji. Na zarządzanym komputerze może być wymagany administrator.
- **iPhone/iPad:** pobierz w Safari, zainstaluj profil w Ustawieniach, następnie Ogólne → To urządzenie → Ustawienia zaufania certyfikatów → włącz pełne zaufanie dla Vanly Local.

Po instalacji zamknij i otwórz przeglądarkę, a następnie wejdź na `https://vanly.local/`. Nie przechodź dalej przez ostrzeżenie o nieprawidłowym certyfikacie; sprawdź instalację i odcisk. Niektóre przeglądarki z osobnym magazynem certyfikatów mogą wymagać importu również w swoich ustawieniach.

Publiczny odcisk na serwerze można sprawdzić ponownie:

```sh
openssl x509 -in '/Library/Application Support/Vanly/public/vanly-root.crt' -noout -fingerprint -sha256
```

Odcisk wdrożonego certyfikatu głównego SHA-256:

`B8:9A:40:DD:55:37:8D:95:A5:15:B1:40:0B:E5:6C:A4:40:CE:B5:44:A5:CF:8A:74:37:35:3C:14:40:B1:51:18`

Zaufanie urzędowi certyfikacji jest ustawieniem bezpieczeństwa klienta. Zachowaj prywatne klucze na serwerze; udostępniaj jedynie plik `.crt`. Standardowe certyfikaty publiczne nie obejmują lokalnej nazwy `.local`.

## Sesje i mapy

Lista origin w `APP_ORIGIN` i `APP_ADDITIONAL_ORIGINS` jest dokładna, bez wildcardów. Linki do resetu hasła używają `APP_ORIGIN`. Zmiana samego proxy nie zmienia tej konfiguracji aplikacji.

Nginx nadpisuje nagłówek `X-Vanly-Protocol` w żądaniach do API zgodnie z rzeczywistym protokołem połączenia. Sesje HTTPS używają `__Host-vanly_session`, `Secure`, `HttpOnly`, `SameSite=Strict`, ścieżki `/` i bez Domain. Sesje HTTP pozostają osobne; aplikacja nie przenosi ich automatycznie między protokołami. Ochrona origin i CSRF obowiązuje również w LAN. Backend musi pozostać dostępny wyłącznie przez zaufany proxy/loopback.

**Google Maps:** istniejący klucz dopuszcza HTTP. Do pracy map przez HTTPS trzeba dopisać `https://vanly.local/*` do dozwolonych witryn klucza „Vanly local — mapa i kempingi” w projekcie `vanly-maps-20260923`. Nie zmieniać ograniczeń dwóch API ani przydziałów kosztowych. Ta zmiana w Google Cloud pozostaje niewykonana z powodu tego samego błędu narzędzia przeglądarki. [Edycja istniejącego klucza](https://console.cloud.google.com/apis/credentials/key/14ece6eb-ddc8-48e5-8e34-4b02a882e172?project=vanly-maps-20260923).

Udostępnienie LAN i lokalny certyfikat nie tworzą płatnego zasobu ani abonamentu. Koszty i limity Google Maps pozostają osobne, zgodnie z `Google-Maps.md`.

## Odzyskiwanie Nginx

Punkt odzyskiwania wspólnej konfiguracji VANLY `/Library/Application Support/Vanly/nginx-backups/latest` będzie zawierał wyłącznie Nginx. Po zakończeniu instalacji można przywrócić poprzednią konfigurację Nginx:

```sh
sudo /bin/sh '/Library/Application Support/Vanly/rollback-nginx.sh'
```

Odzyskiwanie nie odtwarza dawnego serwera i zachowuje CA w `tls/ca`, zaufanie urządzeń oraz dane aplikacji. Konfiguracja `local.nginx.compat` znajduje się osobno w `/Library/Application Support/LocalNginx`; kopia VANLY nie zastępuje jej konfiguracji.

## Historyczne wyniki kontroli przed instalacją z 23.09.2026

- Składnia skryptów i konfiguracja Caddy: poprawne.
- Kompilacja API oraz 15 testów integracyjnych: zaliczone, w tym origin, CSRF i rozdzielenie cookies HTTPS/HTTP.
- Caddy na testowych portach 8180/8443: prawidłowy HTTP i zweryfikowany TLS na loopback, Ethernet i Wi-Fi. Certyfikatu nie ignorowano; klient używał jawnego testowego CA.
- Pełne połączenie Caddy → Next → API: logowanie, odczyt sesji i wylogowanie w obu protokołach; nagłówek protokołu przesłany przez klienta HTTP został nadpisany przez proxy.
- Pobieranie publicznego certyfikatu poprawne; klucz prywatny nie jest dostępny w publicznym katalogu.
- Krótkie ogłoszenie Bonjour na Ethernet: `vanly.local` zarejestrowane, zapytanie mDNS zwróciło `192.168.188.44`. Ogłoszenie testowe i proces testowy Caddy zakończono.
- Nie przeprowadzono testu z fizycznie drugiego komputera ani kontroli interfejsu w przeglądarce: drugi komputer nie jest dostępny przez narzędzia, a narzędzie przeglądarki nie mogło zweryfikować polityki administratora.

## Historyczna kontrola po wdrożeniu z 23.09.2026

- HTTP i HTTPS na portach 80/443 odpowiadają poprawnie na wszystkich trzech powyższych adresach; API potwierdza działanie PostgreSQL.
- `security verify-cert -v https://vanly.local` zakończyło się `certificate verification successful` z łańcuchem Vanly Local.
- Żądanie HTTPS korzystające z natywnego magazynu macOS (`CURL_SSL_BACKEND=secure-transport`) również przeszło. Domyślny backend LibreSSL w systemowym curl nie korzystał z tego samego magazynu; z jawnym `--cacert` weryfikacja też była poprawna. Nie wyłączano sprawdzania certyfikatów.
- Bieżące zapytanie mDNS na Ethernet zwróciło `vanly.local → 192.168.188.44`.
- Ponowna próba dostępu do Google Cloud przez narzędzie przeglądarki nadal była zablokowana przez niedostępną weryfikację zasad administratora.

Źródła: [Caddy — lokalne HTTPS](https://caddyserver.com/docs/automatic-https), [Caddy — bind](https://caddyserver.com/docs/caddyfile/directives/bind), lokalna instrukcja macOS `man dns-sd`, [Apple — własne certyfikaty na iOS](https://support.apple.com/en-us/102390).
