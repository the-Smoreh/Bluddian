/**
 * Bluddian builds to a folder of static files. There is no server.
 *
 * BASE_PATH exists for GitHub Pages, which serves projects from
 * https://user.github.io/<repo>/ rather than a domain root. Leave it unset when
 * deploying to a root domain (Cloudflare Pages, Netlify, a folder on your own
 * host), which is the simpler and recommended path.
 */
const basePath = process.env.BASE_PATH ?? '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  /**
   * Static export: the build produces plain HTML/CSS/JS with no Node process.
   * That is what makes "the phone is the database" true — there is nothing to
   * deploy but files, and nothing to run but the browser.
   *
   * It also means every route is a client component: no server components, no
   * API routes, no middleware. All of that was deleted along with the backend.
   */
  output: 'export',

  basePath,
  // Exposed to the client so the service worker and manifest can be registered
  // at the right URL under a subpath deploy.
  env: { NEXT_PUBLIC_BASE_PATH: basePath },

  // Static hosts serve /money as /money/index.html.
  trailingSlash: true,

  images: { unoptimized: true },
};

export default nextConfig;
