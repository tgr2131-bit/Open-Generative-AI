/** @type {import('next').NextConfig} */
// allowedDevOrigins is deliberately NOT set by default.
//
// In Next 15, *defining* this option switches the dev server from `warn` to
// `block` mode (see next/dist/server/lib/router-utils/block-cross-site.js):
//
//   const mode = typeof allowedDevOrigins === 'undefined' ? 'warn' : 'block';
//
// Worse, the cross-site branch for subresources never consults the allowlist -
// it blocks unconditionally:
//
//   if (sec-fetch-mode === 'no-cors' && sec-fetch-site === 'cross-site') {
//       return warnOrBlockRequest(res, undefined, mode);   // allowlist ignored
//   }
//
// A browser loading this app inside a cross-site preview pane requests
// /_next/static/* with exactly those headers, so any value set here answers 403
// and the page renders blank with no JavaScript. Leaving it undefined keeps the
// default `warn` behaviour: requests are served and Next only logs advice about
// a future major version.
//
// Set OGA_ALLOWED_DEV_ORIGINS only to opt *into* blocking (for example when
// exposing the dev server on a shared network) - and expect embedded previews
// to stop working if you do.
const configuredDevOrigins = (process.env.OGA_ALLOWED_DEV_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig = {
  transpilePackages: ['studio', 'ai-agent', 'workflow-builder', 'design-agent'],
  ...(configuredDevOrigins.length > 0 ? { allowedDevOrigins: configuredDevOrigins } : {}),
};

export default nextConfig;
