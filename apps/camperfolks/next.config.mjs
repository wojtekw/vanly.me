import frontofficeConfig from '../frontoffice/next.config.mjs';

// A second build and process of the same complete product, with its own brand.
// Environment and anonymous SSR requests continue to use the existing Vanly API.
process.env.NEXT_PUBLIC_PORTAL_BRAND = 'camperfolks';
process.env.SEO_SITE_URL = process.env.CAMPERFOLKS_SITE_URL || 'https://camperfolks.com.local';
process.env.SEO_INDEXING_ENABLED = 'false';

export default {
  ...frontofficeConfig,
  env: { ...frontofficeConfig.env, NEXT_PUBLIC_PORTAL_BRAND: 'camperfolks' },
};
