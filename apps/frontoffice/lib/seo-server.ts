import { cache } from 'react';
import { searchCatalogPath, type SearchParams, type SeoRoute } from './seo';
import { offerDates, warsawToday } from './seo-dates';

export const todayForRequest = cache(warsawToday);

export class PublicApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail = false,
  ) {
    super(`Public Vanly API unavailable (${status}).`);
  }
}

export const isMissingPublicRecord = (error: unknown) =>
  error instanceof PublicApiError && error.detail && error.status === 404;

// Anonymous reads only: no request cookies, roles, account or booking data reach the HTML.
export const fetchPublicApi = cache(async (path: string, detail = false) => {
  const base = (process.env.SEO_API_INTERNAL_URL || 'http://127.0.0.1:4100/api/v1').replace(
    /\/$/,
    '',
  );
  const response = await fetch(base + path, {
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  // Metadata must handle a missing record without throwing Next's notFound
  // boundary; the page owns that boundary so its HTML shell can render.
  if (!response.ok) throw new PublicApiError(response.status, detail);
  return response.json();
});

export async function loadPublicPage(
  route: SeoRoute,
  searchParams: SearchParams = {},
  today = todayForRequest(),
) {
  const initialData: Record<string, any> = {};
  let record: Record<string, any> | undefined;
  if (!route.publicPage) return { initialData, record };
  let endpoint: string | undefined;
  if (route.kind === 'home') endpoint = '/catalog';
  if (route.kind === 'search') endpoint = searchCatalogPath(searchParams);
  if (route.kind === 'guides') endpoint = '/articles?kind=guide';
  if (route.kind === 'discover') endpoint = '/articles';
  if (route.kind === 'vehicle') {
    const { start, end } = offerDates(searchParams, today);
    endpoint = '/vehicles/' + encodeURIComponent(route.id!) + '?start=' + start + '&end=' + end;
  }
  if (route.kind === 'article') endpoint = '/articles/' + encodeURIComponent(route.id!);
  if (endpoint) {
    try {
      const data = await fetchPublicApi(endpoint, ['vehicle', 'article'].includes(route.kind));
      initialData[endpoint] = data;
      if (['vehicle', 'article'].includes(route.kind)) record = data;
    } catch (error) {
      // A malformed search remains noindex and the client displays the API's validation message.
      // Infrastructure errors must still produce 5xx instead of an indexable empty catalog.
      if (!(route.kind === 'search' && error instanceof PublicApiError && error.status === 400))
        throw error;
    }
  }
  return { initialData, record };
}
