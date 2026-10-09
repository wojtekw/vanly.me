VANLY — szablony e-mail / 7 października 2026

ZAWARTOŚĆ
00 — szablon bazowy transakcyjny.
01–11 — gotowe treści transakcyjne do wstawienia danych.
12 — odrębny newsletter z przykładową treścią o przygotowaniu pierwszego wyjazdu.
Każdy szablon ma HTML i odpowiednik text/plain. manifest.json zawiera tematy,
preheadery, zdarzenia, warunki wysyłki, zmienne i warianty treści.

CHARAKTER PAKIETU
To propozycja produkcyjna, nie konfiguracja działającej wysyłki. Lokalny VANLY
korzysta obecnie z lokalnej skrzynki; płatności, zwroty i kaucje są testowe.
Weryfikacja adresu jest proponowanym nowym mechanizmem. Nie wysłano żadnego maila.

URUCHOMIENIE
1. Uzupełnij wszystkie zmienne {{nazwa}}. Nie wysyłaj maila z pustą zmienną,
   surowym znacznikiem, przykładową domeną lub adresem instalacji lokalnej.
2. app_url oznacza docelowy publiczny adres HTTPS VANLY. action_url to pełny
   publiczny adres HTTPS formularza lub widoku, zbudowany na bazie app_url.
   Nie zakodowano domeny ani ścieżek, ponieważ produkcyjne adresy wymagają ustalenia.
   Ten sam action_url jest przyciskiem i linkiem zapasowym. Link do prywatnej
   rezerwacji, protokołu lub rozmowy wymaga autoryzacji dostępu po zalogowaniu.
   Otworzenie linku nie wykonuje płatności, anulowania ani potwierdzenia protokołu.
3. HTML-escape wszystkie wartości tekstowe. Wartości URL waliduj osobno:
   tylko zaufane publiczne HTTPS, bez javascript:, bez cudzych redirectów.
   Nie wstawiaj niesprawdzonego HTML użytkownika. Templating nie może wykonywać
   treści zmiennych. Warianty zdań z manifest.json rozwiąż po stronie aplikacji,
   a wynik potraktuj jak zwykły tekst. Nie wykonuj ogólnego rekurencyjnego renderu.
4. Temat wysyłki pochodzi z manifest.json; usuń CR/LF z jego zmiennych.
   Pole title w HTML nie zastępuje nagłówka Subject wiadomości.
5. Wyślij multipart/alternative z UTF-8: najpierw text/plain, potem text/html.
   Daty i godziny przygotuj w strefie odbiorcy; domyślnie Europe/Warsaw.
   Kwoty podawaj z walutą, np. formatterem aplikacji; nie sumuj w szablonie.
   current_year pochodzi z czasu wysyłki. Dane prawne i support_email muszą
   pochodzić z konfiguracji zweryfikowanego nadawcy, bez wymyślonych danych.
6. Wyślij tylko na zweryfikowany adres konta lub zweryfikowany adres rezerwacji
   według ustalonej polityki. Dla firmy sprawdź aktualne uprawnienia odbiorcy.
   Przed każdym przypomnieniem sprawdź aktualny stan; deduplikuj zdarzenia.
7. Zrób test skrzynkowy na kontrolowanych kontach w Gmail, Outlook i Apple Mail
   (komputer + telefon), test linków i testy realnego dostawcy. QA w tym pakiecie
   nie zastępuje kontroli renderowania w klientach pocztowych i dostarczalności.

ZAŁĄCZNIKI I TRWAŁY NOŚNIK — WYMAGANE PRZED WYSYŁKĄ
04-rezerwacja-potwierdzona wymaga faktycznych załączników: podsumowania
potwierdzonej rezerwacji oraz utrwalonej zaakceptowanej wersji warunków / umowy.
06-zmiana-dat-z-doplata wymaga nowego podsumowania oraz utrwalonych warunków
uzgodnionej zmiany / aneksu. To wymagania integracji produkcyjnej, a nie opis
funkcji istniejących w lokalnym VANLY. Lokalne podsumowanie nie jest automatycznie
umową, fakturą ani polisą. Pakiet nie zawiera fikcyjnego regulaminu.
Nie wysyłaj wariantu mówiącego o załącznikach, dopóki pliki nie powstaną i nie
zostaną dołączone. Zapisz wersję warunków, czas i dowód akceptacji, identyfikatory
załączników i wersję rezerwacji. PDF / snapshot musi zachować uzgodnioną treść,
dać się przechować i odtworzyć bez zmiany; sam link do edytowalnej strony to za mało.
attachment_names odpowiada rzeczywiście dołączonym nazwom plików.

PŁATNOŚCI I STATUSY
03 wysyłaj wyłącznie dla prośby pending. 04 raz po confirmed: instant lub accepted.
Plan: zaliczka 30% albo pełna wpłata; kwota i status pochodzą z księgi rozliczeń.
Dopłata standardowo 7 dni przed odbiorem. Przy pełnej wpłacie balance_amount = 0,
a balance_due_label = „Nie dotyczy — wyjazd jest opłacony”. Przy braku dopłaty
nie wysyłaj 07. Termin i opóźnienia wynikają z zatwierdzonych reguł produktu.
06 jest przykładem wariantu z dopłatą: additional_amount oznacza rzeczywistą
pozostałą należność po zmianie, a nie zawsze sam wzrost ceny. Dla zmiany bez
dopłaty lub z nadpłatą użyj bazy i osobnego wariantu; nie sugeruj płatności.
08 oznacza cancellation + refund_pending. Nie obiecuje pełnej kwoty ani terminu.
09 dopiero po zaufanym refund_succeeded, nie po wysłaniu żądania zwrotu.
refund_scope_label wskazuje „zwrot częściowy”, „zwrot wpłaty za najem” lub
„zwrot kaucji” zgodnie z rzeczywistym rozliczeniem. Nie wpisuj pełnych danych karty.
Anulowanie, zwrot wpłaty, status kaucji i zaksięgowanie w banku są odrębne.

BEZPIECZEŃSTWO I PRYWATNOŚĆ
02: jednorazowy token, TTL 30 min, bez hasła, bez pytania o dane karty; reset
powinien unieważniać dotychczasowe sesje zgodnie z polityką konta.
01: verification_expires_at musi odpowiadać rzeczywistemu TTL tokena; okresu
ważności nie narzucono w tym przykładzie. Skanery maili nie mogą potwierdzać
konta ani zużywać tokena na samo automatyczne otwarcie linku.
11: nie umieszczaj podglądu prywatnej treści, danych kierowców, dokumentów,
szkód ani danych karty w temacie lub body. Ogranicz conversation_context_label
do bezpiecznej nazwy pojazdu albo numeru rezerwacji.
Powiadomienie o rozmowie kieruje do aplikacji. Reply-To można skierować do
wsparcia, lecz nie sugeruj, że odpowiedź dołącza do rozmowy, jeśli brak integracji.

NEWSLETTER
12 ma oddzielny wygląd i podstawę wysyłki. Nie dodawaj ofert marketingowych
do szablonów transakcyjnych. Sprawdzaj zgodę i listę wykluczeń przed wysyłką.
Wypełnij unsubscribe_url działającym linkiem rezygnacji oraz skonfiguruj
List-Unsubscribe i List-Unsubscribe-Post u dostawcy. one_click_unsubscribe_url
dotyczy endpointu do obsługi POST; nie umieszczono go w treści maila.
Widoczna rezygnacja nie wymaga logowania. Wyłączenie marketingu nie blokuje
maili koniecznych do konta i rezerwacji. Przykładową treść newslettera użyj
tylko wtedy, gdy odpowiada rzeczywiście opublikowanemu poradnikowi.

WYGLĄD I TON
Paleta marki: len #F6F3EB, zieleń #173D35, tekst #242B27, szałwia #DDE5D8,
powierzchnia #FFFEFA. Arial jako podstawowa czcionka. Tabele prezentacyjne,
inline CSS, kontener maks. 600 px, brak zewnętrznych obrazków, fontów i skryptów.
Jeden główny przycisk oraz tekstowy link zapasowy; newsletter ma dodatkowo
obowiązkowy link rezygnacji. Ton: prosty, spokojny i konkretny, z jasno wskazanym
statusem, kwotą i następnym krokiem. Bez marketingu w mailach transakcyjnych.
