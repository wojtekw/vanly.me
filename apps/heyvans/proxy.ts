export { proxy } from '../frontoffice/proxy';

// Next requires a literal matcher in each application's entry point.
export const config = {
  matcher: [
    '/((?!api(?:/|$)|_next(?:/|$)|assets(?:/|$)|favicon\\.svg$|manifest\\.webmanifest$|robots\\.txt$|sitemap\\.xml$|_not-found(?:/|$)).*)',
  ],
};
