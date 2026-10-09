# Google Maps w Vanly

Aktualizacja UX po uruchomieniu LAN (23.09.2026): użytkownik potwierdził, że mapa działa. Wcześniejsze zgłoszenie wynikało z oczekiwania mapy widocznej od razu. Wprowadzono automatyczny start mapy Polski i jednego wyszukiwania kempingów po otwarciu zakładki, do 20 wyników, natychmiastowe skróty regionów oraz „Szukaj w tym obszarze”. Widok początkowy zachowuje całą Polskę, a wyszukiwanie obszaru zachowuje przybliżenie. Konfiguracja klucza HTTPS została na życzenie użytkownika odłożona; nie zmieniono ograniczeń API ani przydziałów.

Stan na 23 września 2026: integracja jest **aktywna** pod `http://vanly.local/kempingi`. Maps JavaScript API zwróciło rzeczywistą mapę, a Places UI Kit — 12 kempingów dla Mazur. Konto rozliczeniowe Vanly Maps jest aktywne i połączone z osobnym projektem `vanly-maps-20260923`. Użytkownik potwierdził prywatny profil rozliczeniowy, weryfikację Revolut, warunki Google Maps Platform oraz aktywację usług i ograniczonego klucza. AWS nie jest wykorzystywany.

## Konfiguracja Google Cloud

- Aktywne usługi map: **Maps JavaScript API** (`maps-backend.googleapis.com`) i **Places UI Kit** (`placewidgets.googleapis.com`).
- Klucz `Vanly local — mapa i kempingi` jest ograniczony do tych dwóch API oraz stron `http://vanly.local/*`, `http://localhost:3100/*`, `http://127.0.0.1:3100/*`.
- Przygotowana konfiguracja LAN/HTTPS wymaga dodatkowego wpisu `https://vanly.local/*`. **Nie został jeszcze zapisany**: narzędzie przeglądarki odmówiło dostępu do Google Cloud z powodu niedostępnej weryfikacji polityki administratora. Dotychczasowa mapa HTTP pozostaje działająca. Szczegóły: `Siec-lokalna.md`.
- Wartość klucza znajduje się wyłącznie w prywatnym `.env.local` (uprawnienia 600). Klucz przeglądarkowy jest widoczny w żądaniu do Google zgodnie z modelem tej usługi; nie daje dostępu do bazy Vanly.
- `GOOGLE_MAPS_ENABLED=true` i `GOOGLE_MAPS_QUOTAS_CONFIRMED=true` ustawiono dopiero po potwierdzeniu poniższych limitów w konsoli.
- Lokalna mapa używa `DEMO_MAP_ID`, wystarczającego do testowania znaczników. Przed wdrożeniem publicznym można przygotować własny identyfikator i styl oraz osobny klucz domeny produkcyjnej.
- Szczegóły administracyjne, identyfikatory i stan testów są w `.local/google-cloud-setup.json`.

## Ograniczenia kosztów

Google Cloud przyjął i wyświetlił poniższe limity dzienne:

| Usługa i rodzaj użycia | Limit na dobę |
| --- | ---: |
| Maps JavaScript API — Map loads | 200 |
| Maps JavaScript API — 3D Map loads | 0 |
| Maps JavaScript API — Maps Grounding Widget | 0 |
| Places UI Kit — Query Requests | 250 |
| Places UI Kit — Advanced Query Requests | 0 |
| Places UI Kit — Session Requests | 0 |

Dla używanych funkcji oznacza to maksymalnie 6200 ładowań mapy i 7750 zapytań o miejsca w 31-dniowym miesiącu. Każda z tych dwóch kategorii ma obecnie osobną darmową pulę 10 000 zdarzeń miesięcznie. Przy tej konfiguracji i bieżącym cenniku przewidywany koszt użycia przez Vanly wynosi 0 USD. Pule Google są współdzielone na koncie rozliczeniowym; projekt ma osobne konto Vanly Maps. Przed zmianą limitów, usług lub dodaniem projektu do tego konta ponownie sprawdzić koszty. Budżet użytkownika pozostaje maks. 50 USD/miesiąc.

Dodatkowo zapisano miesięczny **alert 100 PLN** z progami 10%, 50% i 100%. Powiadomienia są wysyłane do administratorów/użytkowników konta rozliczeniowego. **Alert nie blokuje wydatków**; ochronę przed nadmiernym użyciem zapewniają przede wszystkim ograniczenia API, odsyłających stron i przydziałów Google. Google zaznacza, że metryki przydziału i rozliczeń mogą się różnić; pozostawiono zapas względem darmowych pul. Nie włączono automatycznego zwiększania limitów.

## Co robi aplikacja

- Tekstowe wyszukiwanie regionu, obszaru mapy i rodzaju `campground` / `rv_park`, maksymalnie 20 wyników. To wyszukiwarka, nie pełny import bazy.
- Własna mapa z punktami opartymi na identyfikatorach i współrzędnych wyników UI Kit. Treści, zdjęcia i przypisania autorstwa renderuje Google w swoich komponentach.
- Szczegóły pobierane po kliknięciu karty lub punktu. Bez zapytań na każde naciśnięcie klawisza lub przesunięcie mapy.
- Brak trwałego zapisu wyników, zdjęć, opinii, zapytań i współrzędnych Google. Tabela `maps_usage` zawiera tylko okres, kategorię licznika i liczbę operacji. Dawne demonstracyjne rekordy `camps` pozostają w bazie, ale nie są prezentowane jako wyniki Google.
- Mapa nie obiecuje dostępności parceli i nie obsługuje rezerwacji kempingów.
- Google jest wczytywane automatycznie po otwarciu zakładki Kempingi, po sprawdzeniu dostępności i zakończeniu pobierania sesji/CSRF. Start wykonuje jedno ładowanie mapy i jedno wyszukiwanie Polski. Kolejne zapytania wykonują się po wybraniu skrótu regionu, wysłaniu formularza lub kliknięciu „Szukaj w tym obszarze”. Wpisywanie i przesuwanie mapy nie uruchamia zapytań o miejsca. Opis połączenia na `/mapy-i-prywatnosc` został zaktualizowany.
- Dla konta w EOG zastosowano Places UI Kit zgodnie z dokumentacją Google.

## Dodatkowe liczniki Vanly

Maks. 100 otwarć mapy na dobę i 2000 na miesiąc oraz 200 zapytań UI Kit (wyszukiwanie i szczegóły łącznie) na dobę i 6000 na miesiąc. Doba i miesiąc są liczone w UTC. Dwa okna są aktualizowane w jednej transakcji z blokadą; restart nie zeruje liczników. Odmowa limitu nie zużywa częściowo drugiego okna. Odrzucona przez Google próba pozostaje policzona ostrożnościowo.

To **liczniki operacji aplikacji, nie odczyt rachunku Google**. Publiczny klucz przeglądarkowy wymaga również ograniczeń po stronie dostawcy, skonfigurowanych powyżej. Awaryjne wyłączenie: `GOOGLE_MAPS_ENABLED=false`, następnie `./vanly restart`; przy podejrzeniu nadużycia ograniczyć lub wyłączyć również klucz/API w Google Cloud.

## Weryfikacja

- Wcześniejsza kompilacja Next/Nest i kontrola TypeScript: poprawne.
- Istniejące testy API Vanly: 14 zaliczonych.
- `./vanly test-camps-ui`: 4 testy komponentu w lokalnym DOM z symulowanym Google, bez przeglądarki i połączeń z Google. Obejmują pojedynczy start po gotowości sesji (także przy powtórzeniu efektów React), regiony, ograniczenie do obszaru, zachowanie kadru, limity i brak pętli po błędzie. Test wizualny tej zmiany pozostaje niedostępny z powodu blokady narzędzia przeglądarki.
- `./vanly test-maps`: wyłączenie bez potwierdzenia limitów, walidacja źródła, równoległe próby przekroczenia limitu, wspólne liczniki wyszukiwania i szczegółów, wycofanie transakcji oraz trwałość po restarcie. Testy z fikcyjnym kluczem zaliczone, bez połączenia z Google.
- Po aktywacji API statusu zwróciło `enabled: true, available: true`.
- Rzeczywisty test w Chrome na `vanly.local`: 12 wyników dla Mazur, widoczna mapa, punkty, karty Google ze zdjęciami i ocenami; bez błędów konsoli w tym teście.
- Kliknięcie punktu uruchomiło panel szczegółów i poprawny odnośnik do wybranego miejsca. Pełnej kontroli treści szczegółów i aktywnego widoku mobilnego nie zakończono: narzędzie przeglądarki dwukrotnie odmówiło dalszego dostępu do `vanly.local`, ponieważ nie mogło zweryfikować polityki administratora. Nie obchodzono tej blokady. Wcześniej sprawdzono responsywny układ stanu przed aktywacją.

## Dokumentacja źródłowa

- https://developers.google.com/maps/comms/eea/places
- https://developers.google.com/maps/documentation/javascript/places-ui-kit/get-started
- https://developers.google.com/maps/documentation/javascript/places-ui-kit/place-search
- https://developers.google.com/maps/documentation/javascript/places-ui-kit/place-details
- https://developers.google.com/maps/documentation/places/web-service/policies
- https://developers.google.com/maps/billing-and-pricing/pricing
- https://developers.google.com/maps/billing-and-pricing/manage-costs
- https://docs.cloud.google.com/billing/docs/how-to/budgets
