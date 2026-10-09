import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import VanlyApp from '../../components/VanlyApp';
import { brand } from '../../lib/brand';
import {
  buildMetadata,
  jsonLdForPage,
  resolveRoute,
  serializeJsonLd,
  type SearchParams,
} from '../../lib/seo';
import { isMissingPublicRecord, loadPublicPage, todayForRequest } from '../../lib/seo-server';

// Resolve record existence before streaming starts, so unavailable public URLs return a real 404.
export const dynamic = 'force-dynamic';
type PageProps = { params: Promise<{ path?: string[] }>; searchParams: Promise<SearchParams> };

async function getPage({ params, searchParams }: PageProps) {
  const [parameters, query] = await Promise.all([params, searchParams]);
  const route = resolveRoute(parameters.path);
  if (!route) return null;
  const today = todayForRequest();
  const data = await loadPublicPage(route, query, today);
  return { route, query, today, ...data };
}

const missingMetadata: Metadata = {
  title: `Nie znaleziono strony | ${brand.name}`,
  description: 'Ta droga się tu kończy. Nie znaleźliśmy tej strony.',
  robots: { index: false, follow: false },
};

export async function generateMetadata(props: PageProps) {
  try {
    const page = await getPage(props);
    if (!page) return missingMetadata;
    return buildMetadata(page.route, page.record, Object.keys(page.query).length > 0);
  } catch (error) {
    if (isMissingPublicRecord(error)) return missingMetadata;
    throw error;
  }
}

export default async function Page(props: PageProps) {
  const page = await getPage(props).catch((error: unknown) => {
    if (isMissingPublicRecord(error)) notFound();
    throw error;
  });
  if (!page) notFound();
  const { route, initialData, record, today } = page;
  return (
    <>
      {jsonLdForPage(route, record).map((data, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
        />
      ))}
      <VanlyApp initialData={initialData} publicPage={route.publicPage} today={today} />
    </>
  );
}
