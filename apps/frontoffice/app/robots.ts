import type { MetadataRoute } from 'next';
import { getSeoConfig } from '../lib/seo';

export const dynamic = 'force-dynamic';
export default function robots(): MetadataRoute.Robots {
  const { indexingEnabled, siteUrl } = getSeoConfig();
  return {
    // Private HTML pages need to be crawlable for their noindex directive to be seen.
    rules: {
      userAgent: '*',
      ...(indexingEnabled
        ? { allow: '/', disallow: ['/api/', '/firma/', '/company/', '/operator/'] }
        : { disallow: '/' }),
    },
    ...(indexingEnabled ? { sitemap: siteUrl + '/sitemap.xml' } : {}),
  };
}
