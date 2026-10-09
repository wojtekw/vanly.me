# VANLY coming soon

Statyczna strona zapowiadająca start 20 października 2026. JavaScript obsługuje wyłącznie opcjonalny Google Analytics i wybór prywatności. Strona działa również bez JavaScript. Nie zawiera formularzy.

Publiczny zestaw do publikacji:

- index.html
- styles.css
- analytics.js
- robots.txt
- sitemap.xml
- assets/

Publikuj te pliki w katalogu głównym domeny vanly.me. Ścieżki assetów są bezwzględne względem domeny. README.md nie jest częścią publicznej strony.

Lokalny podgląd z katalogu repozytorium:

```sh
python3 -m http.server 3190 --bind 127.0.0.1 --directory apps/coming-soon
```

Otwórz http://127.0.0.1:3190/. Dokumentacja projektu i kontroli: docs/coming-soon-design.md.

Pomiar GA4 używa identyfikatora `G-6P7XHCK7L7` w polu `ga4-measurement-id`. Uruchamia się tylko na vanly.me lub www.vanly.me po zgodzie odwiedzającego. Wspólna cookie zapamiętuje wybór na obu adresach przez najwyżej sześć miesięcy. Puste pole, błędny identyfikator, localhost i adres CloudFront wyłączają zarówno pomiar, jak i panel zgody. Enhanced measurement jest wyłączone w strumieniu GA4. Szczegóły konfiguracji i testów: docs/coming-soon-analytics.md.

Ilustracja powstała we wbudowanym ImageGen na podstawie referencji hero.webp i trip.webp istniejącego portalu. Logotyp, font Kalam i licencja pochodzą z bieżącej aplikacji. Grafika udostępniania jest kadrem rzeczywistego HTML.
