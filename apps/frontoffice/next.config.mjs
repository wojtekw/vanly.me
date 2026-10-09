import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { panelRedirects } from '../../packages/ui/portal-routes.mjs';

// The local launcher starts Next from the app directory; service settings live at the workspace root.
config({ path: fileURLToPath(new URL('../../.env.local', import.meta.url)), quiet: true });

const ownerOrigin = process.env.NEXT_PUBLIC_OWNER_ORIGIN || 'https://owner.vanly.me.local';
const adminOrigin = process.env.NEXT_PUBLIC_ADMIN_ORIGIN || 'https://admin.vanly.me.local';
for (const origin of [ownerOrigin, adminOrigin]) {
  const url = new URL(origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin)
    throw new Error('Panel origin must be an exact HTTP(S) origin.');
}

const nextConfig = {
  transpilePackages: ['@vanly/ui'],
  poweredByHeader: false,
  devIndicators: false,
  skipProxyUrlNormalize: true,
  // Wait for public record checks and metadata before sending headers, including for ordinary browsers.
  htmlLimitedBots: /.*/,
  async redirects() {
    return [
      ...panelRedirects.map(({ source, destination, kind }) => ({
        source,
        destination:
          (kind === 'owner' ? ownerOrigin : adminOrigin) +
          destination,
        permanent: true,
      })),
      {
        source: '/firma/:path*',
        destination: ownerOrigin + '/company/:path*',
        permanent: true,
      },
      {
        source: '/company/:path*',
        destination: ownerOrigin + '/company/:path*',
        permanent: false,
      },
      {
        source: '/operator/:path*',
        destination: adminOrigin + '/operator/:path*',
        permanent: false,
      },
    ];
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: 'http://127.0.0.1:4100/api/:path*' }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
      ...['/reset', '/potwierdz-email', '/newsletter/:path*'].map((source) => ({
        source,
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      })),
    ];
  },
};
export default nextConfig;
