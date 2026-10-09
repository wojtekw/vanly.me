export { proxy } from '../frontoffice/proxy';

// Next requires the matcher to be a literal in this application's entry point.
export const config = {
  matcher: [
    '/((?!api(?:/|$)|_next(?:/|$)|assets(?:/|$)|favicon\\.svg$|manifest\\.webmanifest$|robots\\.txt$|sitemap\\.xml$|_not-found(?:/|$)).*)',
  ],
};
