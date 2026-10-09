import { NextResponse, type NextRequest } from 'next/server';
import { resolveRoute } from './lib/seo';

function missingPage(request: NextRequest) {
  // Preserve Next's raw internal origin. Normalizing 127.0.0.1 to localhost
  // would turn this into an external HTTPS self-request behind a TLS proxy.
  const destination = new URL('/_not-found', request.url);
  destination.search = '';
  return NextResponse.rewrite(destination, { status: 404 });
}

export async function proxy(request: NextRequest) {
  let segments: string[];
  try {
    segments = request.nextUrl.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return missingPage(request);
  }
  const route = resolveRoute(segments);
  if (!route) return missingPage(request);
  if (route.kind !== 'vehicle' && route.kind !== 'article') return NextResponse.next();

  // Next's dynamic Page error renderer currently sends an empty HTML 404 shell.
  // Select its prerendered custom 404 before rendering, without forwarding a session.
  const base = (process.env.SEO_API_INTERNAL_URL || 'http://127.0.0.1:4100/api/v1').replace(
    /\/$/,
    '',
  );
  const endpoint = route.kind === 'vehicle' ? '/vehicles/' : '/articles/';
  try {
    const response = await fetch(base + endpoint + encodeURIComponent(route.id!), {
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    const missing = response.status === 404;
    await response.body?.cancel().catch(() => undefined);
    if (missing) return missingPage(request);
  } catch {
    // The Page owns upstream errors and responds with 5xx, never a false 404.
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!api(?:/|$)|_next(?:/|$)|assets(?:/|$)|favicon\\.svg$|robots\\.txt$|sitemap\\.xml$|_not-found(?:/|$)).*)',
  ],
};
