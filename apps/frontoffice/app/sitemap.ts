import type { MetadataRoute } from 'next';
import { getSeoConfig, publicPaths } from '../lib/seo';
import { fetchPublicApi } from '../lib/seo-server';

export const dynamic = 'force-dynamic';
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { indexingEnabled, siteUrl } = getSeoConfig();
  if (!indexingEnabled) return [];
  const { vehicles, articles } = await fetchPublicApi('/seo/inventory');
  return [
    ...publicPaths.map((path) => ({ url: siteUrl + path })),
    ...vehicles.map((vehicle: { id: string; updated_at?: string }) => ({
      url: siteUrl + '/pojazd/' + encodeURIComponent(vehicle.id),
      ...(vehicle.updated_at ? { lastModified: vehicle.updated_at } : {}),
    })),
    ...articles.map((article: { id: string; updated_at: string }) => ({
      url: siteUrl + '/artykul/' + encodeURIComponent(article.id),
      lastModified: article.updated_at,
    })),
  ];
}
