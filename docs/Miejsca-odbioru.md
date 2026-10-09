# Miejsca odbioru i podpowiedzi miejscowości

Miejsce odbioru należy do pojazdu. Rejestracja wypożyczalni wymaga tylko nazwy. Flota przechowuje miejscowość lub gminę oraz opcjonalną ulicę i numer budynku/lokalu. Nazwę można wpisać samodzielnie, także gdy nie występuje w podpowiedziach. Współrzędne są opcjonalne; nieznaną lub niejednoznaczną nazwę można zapisać bez punktu na mapie.

Podpowiedzi korzystają z lokalnej kopii [GeoNames dla Polski](https://download.geonames.org/export/dump/PL.zip). Dane: [GeoNames.org](https://www.geonames.org/), licencja [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/). [Format i licencja źródła](https://download.geonames.org/export/dump/readme.txt). Plik zawiera wszystkie mieszczące się w limicie 80 znaków aktywne rekordy miejscowości (klasa P) oraz jednostki ADM3/ADM4 z pobranego zestawu. Pominięto miejscowości historyczne, opuszczone i zniszczone. Dodano polskie nazwy województw, kontekst powiatu/gminy i przedrostek „Gmina” dla ADM3; identyczne etykiety rozróżniają współrzędne. Liczby rekordów i sumy kontrolne znajdują się w `db/localities-pl.source.json`. Dane nie są rejestrem urzędowym i mogą zawierać braki; dlatego wpisanie własnej nazwy pozostaje dostępne.

API `GET /api/v1/localities?q=...` zwraca najwyżej 12 podpowiedzi po wpisaniu co najmniej 2 znaków. Pomija wielkość liter i polskie znaki (również ł), daje pierwszeństwo pełnym nazwom i początkom nazw. Kontekst administracyjny pomaga odróżnić powtarzające się nazwy. Nie korzysta z płatnego API ani żądań Google podczas wpisywania. W interfejsie obok pola znajduje się przypisanie źródła GeoNames.

Odświeżenie pliku: `node scripts/generate-localities.mjs`. Polecenie pobiera krajowy zrzut i tworzy JSON oraz metadane. Aby odtworzyć plik z konkretnej kopii, podaj ścieżkę archiwum jako argument. Skrypt nie zmienia bazy danych. Ponowne uruchomienie API wczytuje odświeżone podpowiedzi.

Migracja `004_vehicle_pickup.sql` nie przepisuje żadnych dawnych miejsc ani współrzędnych. Dodaje puste pola adresowe pojazdów i dopuszcza brak współrzędnych. Szczegóły miejsca w rezerwacji pochodzą z zapisanej wyceny pojazdu, dzięki czemu późniejsza edycja floty nie zmienia istniejących ustaleń. Także zmiana terminu lub wyposażenia zachowuje pierwotne miejsce odbioru; pozostałe parametry i ceny są wyceniane ponownie.

## Wycofanie

Przed migracją wykonaj kopię bazy. Najbezpieczniejsze wycofanie aplikacji pozostawia tę zgodną wstecz migrację: poprzedni kod nadal odczytuje dawne dane. Przed powrotem do poprzedniego formularza trzeba uzupełnić miejsca nowych firm i współrzędne nowych pojazdów, ponieważ dawny interfejs ich wymaga. Nie wpisuj sztucznych współrzędnych.

Pełne wycofanie schematu jest możliwe dopiero po wyeksportowaniu nowych ulic/numerów oraz uzupełnieniu wszystkich nulli prawidłowymi danymi. W transakcji usuń cztery ograniczenia `vehicle_pickup_*`, usuń kolumny `vehicles.street` i `vehicles.house_number`, przywróć `NOT NULL` dla `companies.city/lat/lng` i `vehicles.lat/lng`, a następnie usuń wpis `004_vehicle_pickup.sql` z `schema_migrations`. Usunięcie pól adresowych traci ich zawartość; nie wykonujemy tego automatycznie. Starsze snapshoty rezerwacji pozostają czytelne; brak dawnej ulicy/numeru oznacza pusty adres.
