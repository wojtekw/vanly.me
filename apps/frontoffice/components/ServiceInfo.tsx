import React from 'react';
import Link from 'next/link';
import { brand } from '../lib/brand';
import { serviceInfoPages, serviceOperator, type ServiceInfoKind } from '../lib/service-info';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="stack">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function OperatorDetails() {
  return (
    <div className="stack">
      <p>
        <strong>{serviceOperator.name}</strong>
        <br />
        {serviceOperator.address}
        <br />
        NIP: {serviceOperator.nip} · REGON: {serviceOperator.regon}
      </p>
      {serviceOperator.email && (
        <p>
          E-mail: <a href={'mailto:' + serviceOperator.email}>{serviceOperator.email}</a>
        </p>
      )}
      <p>
        Korespondencję w sprawach serwisu i danych osobowych możesz przesłać na podany adres.
        Użytkownicy kont mogą też skorzystać z <Link href="/konto/pomoc">Moich zgłoszeń</Link>.
      </p>
    </div>
  );
}

function TestVersionNotice() {
  return (
    <aside className="panel stack" role="note">
      <p>
        <strong>Obecna wersja {brand.name} służy do testów.</strong> Oferty pojazdów i wypożyczalnie
        są przykładowe. Płatności i zwroty są testowe: nie pobieramy ani nie zwracamy prawdziwych
        pieniędzy. Rezerwacja w tej wersji nie oznacza zawarcia umowy najmu.
      </p>
    </aside>
  );
}

function Terms() {
  return (
    <>
      <Section title="Korzystanie z serwisu">
        <p>
          W {brand.name} możesz przeglądać pojazdy, poradniki i pomysły na wyjazd bez zakładania
          konta. Konto jest potrzebne do zapisania rezerwacji, ulubionych ofert, rozmów i zgłoszeń.
          Pokażemy Ci dostępne działania po <Link href="/logowanie">zalogowaniu</Link>.
        </p>
      </Section>
      <Section title="Warunki techniczne i dostęp">
        <p>
          Przeglądanie serwisu i korzystanie z konta w obecnej wersji testowej są bezpłatne. Do
          obsługi konta i rezerwacji potrzebujesz połączenia z internetem, aktualnej przeglądarki
          obsługującej JavaScript oraz możliwości zapisania cookie sesji.
        </p>
        <p>
          Dostęp do serwisu może być czasowo ograniczony podczas przerw w jego działaniu.
          Powiadomienia znajdziesz w <Link href="/konto/skrzynka">skrzynce konta</Link>, zamiast w
          wiadomościach e-mail. Sprawę wymagającą pomocy przekaż przez{' '}
          <Link href="/konto/pomoc">Moje zgłoszenia</Link> lub{' '}
          <Link href="/kontakt">kontakt z operatorem</Link>.
        </p>
      </Section>
      <Section title="Konto i bezpieczeństwo">
        <p>
          Podczas <Link href="/rejestracja">rejestracji</Link> podajesz imię, adres e-mail i hasło
          liczące co najmniej 10 znaków. Podawaj poprawne dane, chroń hasło i nie udostępniaj konta
          innym osobom. Po zakończeniu pracy na współdzielonym urządzeniu wyloguj się.
        </p>
        <p>
          Nie zamieszczaj treści bezprawnych, obraźliwych ani naruszających cudze prawa. W
          wiadomościach i zgłoszeniach nie przesyłaj haseł ani zbędnych danych lub dokumentów innych
          osób. Nie podejmuj działań utrudniających korzystanie z serwisu.
        </p>
      </Section>
      <Section title="Rezerwacje testowe">
        <p>
          Dostępność, cena oraz warunki rezerwacji pojawiają się przy wybranym pojeździe i w
          podsumowaniu przed zatwierdzeniem. Wybierz pobyt od 1 do 60 dób, spełniający minimalny
          czas najmu wskazany przez wypożyczalnię.
        </p>
        <p>
          Na zatwierdzenie rezerwacji bez wpłaty w VANLY masz 15 minut. Po wygaśnięciu blokady
          trzeba ponownie sprawdzić dostępność. Po zatwierdzeniu termin pozostaje zajęty, a
          rezerwacja jest potwierdzona lub oczekuje na akceptację wypożyczalni, zależnie od oferty.
        </p>
        <p>
          VANLY nie pobiera opłat od podróżujących ani wpłat za najem i kaucję. Cenę najmu, terminy
          oraz sposób zapłaty uzgadniasz i rozliczasz bezpośrednio z wypożyczalnią.
        </p>
        <p>
          Przy anulowaniu uzgodnij ewentualne rozliczenia bezpośrednio z wypożyczalnią. Aktualny
          stan i dostępne przyciski sprawdzisz w <Link href="/konto">Moich podróżach</Link>.
        </p>
        <p>
          Rezerwacja, płatność, kaucja i dodatkowe usługi mają odrębne statusy. Potwierdzenie
          jednego z tych etapów nie potwierdza pozostałych. Ubezpieczenia, winiety i wypłaty są w
          tej wersji niedostępne.
        </p>
      </Section>
      <Section title="Konto wypożyczalni">
        <p>
          Zacznij od <Link href="/dla-firm">strony dla wypożyczalni</Link>. Rejestracja ma dwa
          kroki: konto i <Link href="/dla-firm/rejestracja">dane wypożyczalni</Link>. Dostęp do
          panelu firmy uzyskasz po zapisaniu danych wypożyczalni. Możesz też dodać firmę do już
          posiadanego konta. Operator weryfikuje firmę przed publikacją ofert; wcześniej możesz
          przygotować pojazdy jako szkice. Pierwszy pojazd dodajesz bezpłatnie. Za drugi i każdy
          kolejny pobieramy jednorazowo 200 zł. Publikacja wymaga rozliczenia tej opłaty; na UAT
          płatność jest testowa i nie pobiera pieniędzy.
        </p>
        <p>
          Wypożyczalnia odpowiada za poprawność opisów pojazdów, cen, dostępności i warunków swojej
          oferty. Panel firmy udostępnia dane przypisane do tej wypożyczalni.
        </p>
      </Section>
      <Section title="Zgłoszenia i zakończenie korzystania">
        <p>
          Problemy z serwisem oraz sprawy wymagające wyjaśnienia zgłoś w{' '}
          <Link href="/konto/pomoc">Moich zgłoszeniach</Link>. Podaj temat, opis i numer rezerwacji,
          jeśli sprawa jej dotyczy. Odpowiedź i status znajdziesz przy swoim zgłoszeniu.
        </p>
        <p>
          Pytania o ofertę, odbiór lub zwrot pojazdu kieruj do właściwej wypożyczalni w{' '}
          <Link href="/konto/wiadomosci">Wiadomościach</Link>. Jeśli chcesz zamknąć konto lub
          zgłosić sprawę bez logowania, skontaktuj się z operatorem. Dane kontaktowe znajdziesz
          poniżej.
        </p>
      </Section>
      <Section title="Operator serwisu">
        <OperatorDetails />
      </Section>
    </>
  );
}

function Privacy() {
  return (
    <>
      <Section title="Administrator danych i kontakt">
        <p>Administratorem danych przekazywanych w serwisie {brand.name} jest:</p>
        <OperatorDetails />
      </Section>
      <Section title="Jakie dane przekazujesz">
        <ul>
          <li>
            Dane konta: imię, adres e-mail i hasło. Hasło jest przechowywane w postaci skrótu, a nie
            jawnego tekstu.
          </li>
          <li>
            Dane profilu, jeśli je uzupełnisz: imię i nazwisko, telefon, imię i nazwisko każdego
            kierowcy wraz z deklarowanym krajem i kategorią uprawnień oraz wybór dotyczący
            inspiracji podróżniczych.
          </li>
          <li>
            Dane rezerwacji: imię i nazwisko, kontaktowy e-mail, wiadomość do wypożyczalni, pojazd,
            termin, liczba podróżujących, wybrane dodatki, podsumowanie ceny, statusy testowych
            płatności i kaucji oraz protokoły odbioru i zwrotu.
          </li>
          <li>
            Treść rozmów, pytań, opinii i zgłoszeń, a także powiadomienia zapisane w skrzynce konta.
          </li>
          <li>
            Dane wypożyczalni i jej ofert, jeżeli dodajesz firmę: nazwa, miejsce odbioru, opisy,
            ceny, zdjęcia i dostępność pojazdów.
          </li>
        </ul>
        <p>
          Dane służą obsłudze konta, rezerwacji, komunikacji i zgłoszeń. Zapisujemy również historię
          zmian i działań związanych z tą obsługą. Formularz kierowców nie zbiera numerów dokumentów
          i nie weryfikuje uprawnień.
        </p>
      </Section>
      <Section title="Kto widzi informacje">
        <p>
          Po zalogowaniu masz dostęp do danych swojego konta. Właściwa wypożyczalnia widzi dane
          związane z obsługą jej rezerwacji i rozmów. Operator ma dostęp do informacji potrzebnych
          do obsługi serwisu, weryfikacji firm i wyjaśniania zgłoszeń.
        </p>
        <p>
          Opublikowane oferty, zdjęcia firm oraz publiczne pytania i opinie mogą być widoczne dla
          osób przeglądających serwis bez konta. Nie zamieszczaj w nich prywatnych danych
          kontaktowych ani dokumentów.
        </p>
      </Section>
      <Section title="Podstawy i czas przetwarzania">
        <ul>
          <li>
            Obsługa konta, rezerwacji testowych i komunikacji służy wykonaniu usługi konta na Twoje
            żądanie — art. 6 ust. 1 lit. b RODO.
          </li>
          <li>
            Dobrowolny wybór dotyczący inspiracji podróżniczych opiera się na zgodzie — art. 6 ust.
            1 lit. a RODO. Możesz ją cofnąć w profilu.
          </li>
          <li>
            Bezpieczeństwo i wyjaśnianie nadużyć opierają się na uzasadnionym interesie
            administratora, którym jest ochrona serwisu i jego użytkowników — art. 6 ust. 1 lit. f
            RODO.
          </li>
        </ul>
        <p>
          Dane konta wykorzystujemy przez okres korzystania z konta. O jego zamknięcie i usunięcie
          danych możesz wystąpić do operatora. Dane rezerwacji, rozmów i zgłoszeń przechowujemy na
          czas obsługi testów oraz wyjaśnienia zgłoszonej sprawy. Wnioski o usunięcie rozpatruje
          operator z uwzględnieniem celu przetwarzania i właściwych przepisów.
        </p>
        <p>Sesja logowania wygasa po 7 dniach lub kończy się wcześniej, gdy się wylogujesz.</p>
      </Section>
      <Section title="Sesja i zewnętrzne mapy">
        <p>
          Plik cookie sesji utrzymuje zalogowanie. Szczegóły znajdziesz w{' '}
          <Link href="/polityka-cookies">informacji o cookies</Link>. Powiadomienia zapisujemy w{' '}
          <Link href="/konto/skrzynka">skrzynce konta</Link> lub na adres e-mail konta, jeśli
          wysyłka jest dostępna.
        </p>
        <p>
          Dostępna mapa Google wczytuje się automatycznie po wejściu do „Kempingi”. Google otrzymuje
          adres IP, dane przeglądarki i wyszukiwany obszar. Informacje i zdjęcia miejsc są
          wyświetlane przez Google, a serwis nie kopiuje ich do swojej bazy. Zapisujemy zbiorcze
          liczby operacji mapy i wyszukiwarki. Więcej opisujemy na stronie{' '}
          <Link href="/mapy-i-prywatnosc">Mapy i prywatność</Link>.
        </p>
        <p>
          Po otwarciu mapy ofert przeglądarka pobiera kafelki mapy od OpenStreetMap. Dostawca
          otrzymuje wtedy adres IP oraz dane przeglądarki. Odnośniki do Google Maps prowadzą do
          zewnętrznego serwisu.
        </p>
      </Section>
      <Section title="Zmiana danych i Twoje prawa">
        <p>
          Dane profilu i wybór dotyczący inspiracji możesz zmienić w{' '}
          <Link href="/konto/profil">Profilu i kierowcach</Link>. W zależności od podstawy
          przetwarzania i swojej sytuacji możesz skorzystać z praw do:
        </p>
        <ul>
          <li>dostępu do swoich danych i otrzymania ich kopii;</li>
          <li>sprostowania nieprawidłowych danych;</li>
          <li>usunięcia danych;</li>
          <li>ograniczenia przetwarzania;</li>
          <li>przenoszenia danych;</li>
          <li>wniesienia sprzeciwu wobec przetwarzania opartego na uzasadnionym interesie.</li>
        </ul>
        <p>
          Zgodę możesz cofnąć w dowolnym momencie. Nie wpływa to na zgodność z prawem przetwarzania
          dokonanego przed jej cofnięciem. Wnioski dotyczące danych przekaż administratorowi przez{' '}
          <Link href="/kontakt">podane dane kontaktowe</Link>. Możesz też zapytać o zakres i czas
          przechowywania danych swojego konta.
        </p>
        <p>
          Opis praw znajdziesz na stronie{' '}
          <a href="https://uodo.gov.pl/pl/493/2254" target="_blank" rel="noopener noreferrer">
            Urzędu Ochrony Danych Osobowych
          </a>
          . Zakres zastosowania poszczególnych praw zależy od Twojej sytuacji i właściwych
          przepisów.
        </p>
        <p>
          Jeśli uważasz, że przetwarzanie Twoich danych narusza przepisy, możesz złożyć skargę do
          Prezesa Urzędu Ochrony Danych Osobowych.{' '}
          <a href="https://uodo.gov.pl/pl/492/2464" target="_blank" rel="noopener noreferrer">
            Sprawdź, jak złożyć skargę do UODO
          </a>
          .
        </p>
      </Section>
    </>
  );
}

function Cookies() {
  return (
    <>
      <Section title="Cookie potrzebny do logowania">
        <p>
          {brand.name} zapisuje cookie sesji po zalogowaniu. Pozwala on rozpoznać Twoje konto przy
          kolejnych działaniach i udostępnić właściwe dane.
        </p>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Cookie</th>
                <th>Do czego służy</th>
                <th>Czas działania</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>__Host-vanly_session</code>
                  <br />
                  <span className="small">Pod adresem HTTP: vanly_session</span>
                </td>
                <td>Utrzymanie sesji zalogowanego użytkownika.</td>
                <td>7 dni lub do wcześniejszego wylogowania.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Cookie działa tylko w domenie, w której się logujesz. Jest zabezpieczony przed odczytem
          przez skrypty strony (HttpOnly) i nie jest przesyłany przy żądaniach z innych witryn
          (SameSite Strict). Przy połączeniu HTTPS jest przesyłany wyłącznie szyfrowanym
          połączeniem.
        </p>
      </Section>
      <Section title="Mapy i usługi zewnętrzne">
        <p>
          Aktywna mapa Google wczytuje się automatycznie po wejściu do zakładki „Kempingi”. Google
          otrzymuje dane połączenia i obszar wyszukiwania. Dostawca mapy stosuje własne zasady
          prywatności. Opis znajdziesz na stronie{' '}
          <Link href="/mapy-i-prywatnosc">Mapy i prywatność</Link>.
        </p>
        <p>
          Mapa ofert pobiera kafelki OpenStreetMap po jej otwarciu. Linki do Google Maps otwierają
          osobny serwis. Możesz przeglądać pozostałe części {brand.name} bez otwierania tych map.
        </p>
      </Section>
      <Section title="Analityka i preferencje">
        <p>
          W tej wersji portal nie korzysta z Google Analytics i nie ustawia własnych cookies
          reklamowych.
        </p>
      </Section>
      <Section title="Ustawienia w przeglądarce">
        <p>
          Cookies możesz usunąć lub zablokować w ustawieniach swojej przeglądarki. Usunięcie albo
          zablokowanie cookie sesji może spowodować wylogowanie i uniemożliwić korzystanie z funkcji
          konta. Samo wylogowanie usuwa cookie sesji.
        </p>
        <p>
          Pytania o cookies i dane możesz skierować do operatora przez{' '}
          <Link href="/kontakt">stronę Kontakt</Link>.
        </p>
      </Section>
    </>
  );
}

function Help() {
  return (
    <>
      <Section title="Jak znaleźć pojazd i zarezerwować termin?">
        <p>
          W <Link href="/pojazdy">wyszukiwarce pojazdów</Link> wybierz miejsce odbioru, daty i
          liczbę podróżujących. Otwórz ofertę i sprawdź wyposażenie, zasady oraz podsumowanie ceny.
          Zaloguj się, aby utworzyć rezerwację testową. Na zatwierdzenie rezerwacji bez wpłaty masz
          15 minut. Po zatwierdzeniu rezerwacja jest potwierdzona lub oczekuje na akceptację
          wypożyczalni; termin pozostaje zajęty.
        </p>
      </Section>
      <Section title="Gdzie znajdę swoją rezerwację?">
        <p>
          Otwórz <Link href="/konto">Moje podróże</Link> i wybierz rezerwację. W jej szczegółach
          znajdziesz status, zasady rozliczenia z wypożyczalnią, dokumenty oraz działania dotyczące
          odbioru, zwrotu i anulowania.
        </p>
      </Section>
      <Section title="Czy płatności są prawdziwe?">
        <p>
          Podróżujący rezerwują bez wpłaty w VANLY. Najem i kaucję rozliczają bezpośrednio z
          wypożyczalnią. Pierwszy pojazd wypożyczalnia dodaje bezpłatnie, drugi i każdy kolejny
          kosztuje jednorazowo 200 zł. Na UAT opłaty za flotę są testowe.
        </p>
        <p>
          Warunki płatności i ewentualnego zwrotu uzgodnij z wypożyczalnią. VANLY nie rozlicza wpłat
          za najem.
        </p>
      </Section>
      <Section title="Jak napisać do wypożyczalni?">
        <p>
          Rozmowę możesz rozpocząć z karty pojazdu. Znajdziesz ją później w{' '}
          <Link href="/konto/wiadomosci">Wiadomościach</Link>. Pytania o konkretny odbiór, zwrot i
          ofertę kieruj do wypożyczalni obsługującej ten pojazd.
        </p>
      </Section>
      <Section title="Jak utworzyć konto lub zmienić zapomniane hasło?">
        <p>
          <Link href="/rejestracja">Utwórz konto</Link>, podając imię, e-mail i hasło liczące co
          najmniej 10 znaków. Jeśli masz konto, <Link href="/logowanie">zaloguj się</Link>. Na
          stronie logowania dostępna jest opcja „Nie pamiętam hasła”.
        </p>
        <p>
          W tej wersji powiadomienia i linki do zmiany hasła trafiają do{' '}
          <Link href="/konto/skrzynka">skrzynki konta</Link> lub na adres e-mail konta, jeśli
          wysyłka jest dostępna. Jeśli nie możesz otworzyć skrzynki, skorzystaj z{' '}
          <Link href="/kontakt">kontaktu z operatorem</Link>.
        </p>
      </Section>
      <Section title="Jak dodać wypożyczalnię i kampery?">
        <p>
          Przejdź na <Link href="/dla-firm">stronę dla wypożyczalni</Link>.{' '}
          <Link href="/rejestracja?next=%2Fdla-firm%2Frejestracja">Utwórz konto</Link> lub zaloguj
          się, a potem podaj <Link href="/dla-firm/rejestracja">dane firmy</Link>. W formularzu
          rejestracji wybierz „Wypożyczalnia”. Po zapisaniu danych firmy zobaczysz potwierdzenie i
          przycisk „Otwórz panel firmy”, gdzie dodasz pojazdy do floty. Publikacja ofert wymaga
          weryfikacji wypożyczalni; wcześniej możesz zapisywać pojazdy jako szkice.
        </p>
      </Section>
      <Section title="Mam już konto podróżującego i chcę dodać wypożyczalnię">
        <p>
          Dodaj wypożyczalnię do tego samego konta. Po zalogowaniu wybierz „Dodaj wypożyczalnię do
          tego konta” lub przejdź do <Link href="/dla-firm/rejestracja">danych wypożyczalni</Link>.
          Zapisanie nazwy firmy i miejsca odbioru otworzy dostęp do panelu wypożyczalni.
        </p>
      </Section>
      <Section title="Gdzie zgłosić problem i sprawdzić odpowiedź?">
        <p>
          Otwórz <Link href="/konto/pomoc">Moje zgłoszenia</Link>, podaj temat i opisz sprawę. Jeśli
          dotyczy rezerwacji, dodaj jej numer. Odpowiedź operatora i status pojawią się przy
          zgłoszeniu. Sprawy bez dostępu do konta możesz przekazać przez{' '}
          <Link href="/kontakt">kontakt z operatorem</Link>.
        </p>
      </Section>
    </>
  );
}

function Contact() {
  return (
    <>
      <Section title="Operator serwisu">
        <OperatorDetails />
      </Section>
      <Section title="Pytanie lub problem z serwisem">
        <p>
          Jeśli masz konto, opisz sprawę w <Link href="/konto/pomoc">Moich zgłoszeniach</Link>.
          Wybierz temat i podaj, co się wydarzyło. Numer rezerwacji pomoże znaleźć właściwą sprawę.
          Odpowiedź i status zgłoszenia znajdziesz w tym samym miejscu.
        </p>
        <p>
          Jeśli nie masz dostępu do konta, skorzystaj z podanych danych operatora. Nie przesyłaj
          hasła ani pełnych danych dokumentów tożsamości.
        </p>
      </Section>
      <Section title="Oferta, odbiór lub zwrot pojazdu">
        <p>
          W tych sprawach skontaktuj się z właściwą wypożyczalnią. Rozmowę rozpoczniesz z karty
          pojazdu, a wcześniejsze ustalenia znajdziesz w{' '}
          <Link href="/konto/wiadomosci">Wiadomościach</Link>. Szczegóły własnych rezerwacji są w{' '}
          <Link href="/konto">Moich podróżach</Link>.
        </p>
      </Section>
      <Section title="Dane osobowe i zamknięcie konta">
        <p>
          Sprawy dotyczące danych osobowych lub zamknięcia konta kieruj do operatora. Podaj adres
          e-mail swojego konta i opisz żądanie, bez przekazywania hasła. Informacje o danych
          znajdziesz w <Link href="/polityka-prywatnosci">Polityce prywatności</Link>.
        </p>
      </Section>
      <Section title="Szybkie odpowiedzi">
        <p>
          W <Link href="/pomoc">Pomocy</Link> opisujemy rejestrację, rezerwacje, testowe płatności i
          dodawanie wypożyczalni.
        </p>
      </Section>
    </>
  );
}

export function ServiceInfo({ kind }: { kind: ServiceInfoKind }) {
  const page = serviceInfoPages[kind];
  return (
    <div className="container section service-info">
      <header className="stack">
        <p className="eyebrow">Informacje o serwisie {brand.name}</p>
        <h1>{page.title}</h1>
        <p className="page-intro">{page.description}</p>
        <p className="small muted">
          Wersja z <time dateTime="2026-10-07">7.10.2026</time>
        </p>
      </header>
      <nav className="service-info-nav" aria-label="Dokumenty i pomoc">
        {Object.entries(serviceInfoPages).map(([key, item]) => (
          <Link key={key} href={item.path} aria-current={key === kind ? 'page' : undefined}>
            {item.title}
          </Link>
        ))}
      </nav>
      <TestVersionNotice />
      <article className="panel stack service-info-content">
        {kind === 'terms' && <Terms />}
        {kind === 'privacy' && <Privacy />}
        {kind === 'cookies' && <Cookies />}
        {kind === 'help' && <Help />}
        {kind === 'contact' && <Contact />}
      </article>
    </div>
  );
}
