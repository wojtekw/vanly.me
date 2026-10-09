# Certyfikat HTTPS VANLY

Portal: https://vanly.me.local. Panele: https://owner.vanly.me.local i https://admin.vanly.me.local.

Jeżeli przeglądarka pokazuje brak zaufania, otwórz http://vanly.me.local/.well-known/vanly/ i pobierz publiczny plik vanly-root.crt. Nie pomijaj ostrzeżenia. Na Macu serwera ten sam publiczny plik jest w /Library/Application Support/Vanly/public/vanly-root.crt.

SHA-256: B8:9A:40:DD:55:37:8D:95:A5:15:B1:40:0B:E5:6C:A4:40:CE:B5:44:A5:CF:8A:74:37:35:3C:14:40:B1:51:18.

macOS: otwórz Dostęp do pęku kluczy. Znajdź „Vanly Local - 2026 ECC Root” w pęku System, otwórz Zaufanie i ustaw „Secure Sockets Layer (SSL): Zawsze ufaj”. Potwierdź hasłem administratora w oknie systemowym. To zastępuje wcześniejsze ograniczenie certyfikatu do vanly.local. W pęku bieżącego użytkownika zaufanie już dodano; Chromium przeszło kontrolę, ale systemowe narzędzia nadal używają wcześniejszego ograniczenia.

Windows: otwórz certyfikat i zainstaluj go w Zaufanych głównych urzędach certyfikacji bieżącego użytkownika.

iPhone/iPad: pobierz w Safari, zainstaluj profil, następnie Ustawienia → Ogólne → To urządzenie → Ustawienia zaufania certyfikatów → włącz pełne zaufanie dla Vanly Local.

Urządzenia muszą być w tej samej głównej sieci domowej. Prywatny klucz certyfikatu pozostaje na serwerze i nie jest udostępniany. Nie wykonano próby z fizycznie drugiego urządzenia.
