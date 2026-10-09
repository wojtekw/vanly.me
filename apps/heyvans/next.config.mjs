import frontofficeConfig from '../frontoffice/next.config.mjs';

// Independent build/process, sharing the existing product components and API.
process.env.NEXT_PUBLIC_PORTAL_BRAND = 'heyvans';
process.env.SEO_SITE_URL = process.env.HEYVANS_SITE_URL || 'https://heyvans.com.local';
process.env.SEO_INDEXING_ENABLED = 'false';

export default {
  ...frontofficeConfig,
  env: { ...frontofficeConfig.env, NEXT_PUBLIC_PORTAL_BRAND: 'heyvans' },
};
