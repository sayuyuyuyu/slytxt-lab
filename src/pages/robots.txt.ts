import type { APIContext } from "astro";

export function GET(context: APIContext) {
  const site = context.site ?? new URL("https://slytxt.dev");

  return new Response(`User-agent: *
Allow: /
Disallow: /bm/
Disallow: /api/

Sitemap: ${new URL("/sitemap.xml", site).href}
`);
}
