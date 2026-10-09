# Poradniki Vanly

23 września 2026 r. dodano 20 pełnych poradników z 20 ilustracjami. Teksty obejmują wybór kampera lub przyczepy, koszt i warunki wynajmu, przygotowanie, życie w drodze oraz zwrot. Mają po około 600–660 słów. Właściwe źródła są linkowane bezpośrednio w treści.

- Kolekcja: `/poradniki`.
- Pierwszy wyjazd: `/artykul/first`.
- Odbiór pojazdu: `/artykul/handover`.
- Pozostałe poradniki: `/artykul/<identyfikator>` wskazany w `db/guides.json`.

Dwa dotychczasowe krótkie poradniki rozwinięto pod istniejącymi adresami `first` i `handover`. Inspiracje `weekend` oraz `family-trip` pozostają osobnymi wpisami.

Treści opublikowano w tabeli `articles` bazy `vanly_local`; są też uwzględnione w danych inicjalizujących `db/seed.json`. Sekcje zachowują format `[śródtytuł, tekst]`, obsługiwany przez panel operatora. Tekst sekcji może zawierać akapity oddzielone pustą linią, `**pogrubienie**` i `[podpis źródła](https://adres)`. Renderer traktuje HTML jako zwykły tekst i dopuszcza wyłącznie odnośniki HTTP(S).

Plik `apps/web/lib/guide-metadata.json` określa kolejność poradników, krótkie opisy kart i opisy alternatywne ilustracji. Obrazy znajdują się w `apps/web/public/assets/guides` w formacie WebP (1536 × 1024 px). Oryginały PNG oraz edytowalne pliki Markdown są w przygotowanej paczce redakcyjnej w projekcie ChatGPT Vanly.com.

`node scripts/import-guides.mjs` ponownie publikuje dokładnie ten zestaw z `db/guides.json`, nadpisując jego obecne wersje w bazie. Korzysta z transakcji, zapisuje kopię wcześniejszych rekordów w `.local/backups` i odmawia pracy z inną bazą niż lokalna `vanly_local`. Nie należy uruchamiać go jako rutynowego startu aplikacji, jeśli treści zostały już zmienione w panelu operatora.

Przy późniejszej redakcji trzeba aktualizować datowane przepisy (prawo jazdy, e-TOLL) i wymagania podróży. Przykładowe kwoty w poradniku o kosztach nie są cennikiem Vanly. Ilustracje przygotowano narzędziem ImageGen w stylistyce obecnego projektu.

Walidacja: testy API i identyfikatorów żądań (`./vanly test`), formatowanie tekstu i bezpieczeństwo odnośników (`node --test tests/article-text.test.mjs`), kompilacja aplikacji oraz sprawdzenie kolekcji i artykułów w przeglądarce.
