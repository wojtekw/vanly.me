# VANLY: zapowiedź startu

Data serwisu: **20 października 2026**. Publiczne pliki: `apps/coming-soon/`.

## Kierunek

Pusta droga znika za górskim horyzontem. Obraz zaprasza do wyobrażenia sobie dalszego ciągu, a tekst podaje tylko datę startu. Strona nie przedstawia pojazdów, mechanik platformy, cen ani przyszłej oferty.

Zastosowano warsztat wydmuch-graphicdesigner i wydmuch-copywriter zgodnie z jawnym zleceniem użytkownika. Nie przeniesiono marki konsultanta, jej branżowego języka ani rysunkowych portretów. Look and feel, język polski, kolorystyka i Kalam pochodzą z `docs/prototype-v3.html`. Aktualny logotyp `Vanly.me / Jedź po swoje!` pochodzi z bieżącej aplikacji. Obraz jest nowym assetem opartym stylistycznie na istniejących ilustracjach.

Rozważono dwa kierunki:

| Kierunek | Główna myśl | Reprezentatywny tekst |
| --- | --- | --- |
| Horyzont, wybrany | Dalszy ciąg podróży pozostaje otwarty. Data jest jedyną konkretną obietnicą. | „Więcej drogi. Już wkrótce.” / „Zostaw trochę miejsca na to, co przed Tobą.” |
| Premiera | Data i zaproszenie na premierę są punktem wyjścia. | „Zapisz tę datę.” / „20 października otwieramy VANLY. Resztę odkryjesz na miejscu.” |

Wybrano Horyzont, ponieważ zachowuje rozpoznawalny motyw „więcej drogi” ze źródłowego portalu i nie zdradza zakresu usługi.

## Publiczne copy

- Nadtytuł: „Przed nami nowy horyzont”.
- Nagłówek: „Więcej drogi. Już wkrótce.”
- Wprowadzenie: „Zostaw trochę miejsca na to, co przed Tobą.”
- Data: „Start serwisu / 20 października 2026”.
- Stopka: „Do zobaczenia w drodze.” / „© 2026 VANLY”.
- Tytuł SEO: „VANLY — start 20 października 2026”.
- Opis SEO: „Więcej drogi. Już wkrótce. VANLY startuje 20 października 2026. Zostaw trochę miejsca na to, co przed Tobą.”

## Układ i zachowanie

Papier `#faf8f3`, zieleń `#143b39`, tekst `#172f31`, drugi plan `#67736f`, ochra `#bd8c46`. Nagłówek oraz podpis stopki korzystają z lokalnego Kalam Bold; tekst informacyjny z fontu systemowego. Licencja Kalam jest zachowana w katalogu assets.

Desktop: tekst po lewej i data pod tekstem, a cała kompozycja jest wyśrodkowana w obszarze do 1480 px, powiązanym z nagłówkiem i stopką. Ilustracja zachowuje pełne proporcje 3:2; osobne maski wygaszają jej cztery krawędzie, a lewy gradient zapewnia spokojne tło pod tekstem. Mobile do 740 px: najpierw treść oraz data, dalej pionowy kadr krajobrazu o szerokości ekranu, bez bocznych przesunięć, z miękkimi brzegami. Odstępy i rozmiar tekstu dostosowano również do 320 px. Oficjalny logo-dark.png ma szeroki przezroczysty margines; został optycznie wyrównany przez ramkę w CSS, bez modyfikacji obrazu.

Ilustracja jest dekoracyjna. Treść, data i logo mają rzeczywiste elementy HTML. Strona działa bez JavaScript. Jedyny element klawiaturowy to link pomijania nagłówka do treści głównej. Delikatne wejście tekstu i obrazu trwa do 1,1 s i jest wyłączone przy `prefers-reduced-motion`. Nie ma ciągłej animacji.

Bez formularzy, analityki, cookies, zewnętrznych fontów i zewnętrznych żądań. Brak nieczynnych CTA. SEO zawiera canonical, Open Graph, grafikę 1200 × 630, favicon, robots.txt oraz sitemap.xml.

## Assety

- `assets/logo-dark.png`: istniejący logotyp bez zmiany.
- `assets/horizon.webp`: nowa ilustracja 1536 × 1024; WebP 343 860 bajtów.
- `assets/og-coming-soon.png`: wykonany w przeglądarce kadr HTML 1200 × 630 do udostępniania, z zagęszczonym układem tekstu i pełnym miękkim brzegiem krajobrazu.
- `assets/Kalam-Bold.ttf`, `assets/OFL-Kalam.txt`: font i licencja z portalu.
- `assets/favicon.svg`: oszczędna ikona gór i drogi, oparta na motywie znaku.

Ilustrację wygenerowano wbudowanym ImageGen. Oryginał zachowano w `/Users/wojtek/.codex/generated_images/01a0f288-aa7c-7ae2-8f48-fba2a30258d7/exec-6fe710fb-8493-45a0-85d3-9963991f666f.png`; asset produkcyjny znajduje się we workspace.

Końcowy prompt:

> Use case: illustration-story. Asset type: single landscape illustration for the VANLY coming-soon website. Input images: hero.webp and trip.webp are STYLE REFERENCES ONLY; they establish hand-painted travel illustration with fine dark pencil contours, soft pigments, beautiful naturalistic Alpine landscape, muted sage and ochre tones, and feathered painterly edges. Create a NEW scene, do not edit or reproduce their camper, people, or handwritten text. Primary request: an empty winding road leading beyond a sunlit mountain pass, a poetic hint of a journey that has not yet begun. Medium: sophisticated travel journal watercolor and ink illustration, naturalistic mountain details, soft dry-brush strokes, softly feathered unfinished edges dissolving into warm paper. Scene: forested foothills and pale distant Alpine peaks, a ribbon of quiet narrow road sweeping from the lower right foreground toward a golden opening in the center distance; no road markings needed. Composition: wide landscape about 3:2, the scene occupies the right and lower areas and naturally fades to generous empty warm paper on the left and at the top; strongest foreground in lower right, atmospheric mist in distance; avoid rectangular image boundary. Color palette: warm paper #faf8f3 background, muted dark pine #143b39, sage #e9eee5, misty blue-gray, restrained warm ochre #bd8c46. Mood: calm, optimistic, expansive early autumn morning, not dramatic. Constraints: NO typography, lettering, dates, logos, UI, cars, vans, campervans, caravans, people, buildings, campsites, signs, icons, watermarks; reveal only the road and landscape. The final image is artwork only, all website text will be added separately.

## Weryfikacja

Przegląd w Chromium obejmował szerokości 320, 360, 390, 430, 740, 768, 1024, 1440 i 1920 px. Brak przewijania poziomego, błędów strony, nieudanych żądań i połączeń zewnętrznych. Sprawdzono link klawiaturowy, prawidłowe przeniesienie fokusu do main, wyłączenie animacji przy reduced-motion, dostępność obrazów oraz czytelność daty przy wyłączonym JavaScript.

Obejrzano rzeczywiste kadry desktop, mobile 320 i 390 oraz tablet 768. Kadry i raport pozostawiono w `.local/qa/coming-soon-*.png` oraz `.local/qa/coming-soon-verification.json`. To kontrola konkretnego widoku, nie formalny audyt dostępności.

Nie zmieniono Next.js, NestJS ani bazy danych. Publikacja i konfiguracja domeny należą do nadrzędnego zadania.
