/** @type {import('next').NextConfig} */
const nextConfig = {
  // The PHP app relies on "/admin/" keeping its trailing slash (relative links like "client" resolve against it).
  skipTrailingSlashRedirect: true,
  poweredByHeader: false,
  serverExternalPackages: ['mysql2', 'firebase-admin', 'nodemailer', 'cloudinary'],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  async rewrites() {
    // User uploads live in the file store (Cloudinary, or ./storage in development), not in ./public, so files added at runtime are served.
    // `fallback` rewrites only apply when no static file matches: logos uploaded in Site Settings are not part of the build.
    return {
      fallback: [{ source: '/img/logo/:path*', destination: '/api/logo/:path*' }],
      afterFiles: [
      { source: '/docs/:path*', destination: '/api/files/docs/:path*' },
      { source: '/img/registers/:path*', destination: '/api/files/img/registers/:path*' },
      { source: '/img/receiving-notes/:path*', destination: '/api/files/img/receiving-notes/:path*' },
      { source: '/img/quality/:path*', destination: '/api/files/img/quality/:path*' },
      { source: '/img/signatures/:path*', destination: '/api/files/img/signatures/:path*' },
      { source: '/img/media/:path*', destination: '/api/files/img/media/:path*' },
      { source: '/vid/media/:path*', destination: '/api/files/vid/media/:path*' },
      { source: '/img/production/:path*', destination: '/api/files/img/production/:path*' },
      ],
    };
  },
};
export default nextConfig;
