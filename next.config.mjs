/** @type {import('next').NextConfig} */
// Dev-only: origins allowed to request /_next/* resources when the dev server is
// reached through a proxy/hostname other than localhost (Codespaces, containers,
// tunnel and sandbox previews). Next.js warns about these origins today and will
// block them in a future major version. Comma-separated; supports wildcards.
const allowedDevOrigins = (process.env.OGA_ALLOWED_DEV_ORIGINS || '*.e2b.app')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig = {
  transpilePackages: ['studio', 'ai-agent', 'workflow-builder', 'design-agent'],
  allowedDevOrigins,
};

export default nextConfig;
