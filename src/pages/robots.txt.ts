import type { APIContext } from "astro";

export function GET(context: APIContext) {
  const site = context.site ?? new URL("https://slytxt.dev");

  return new Response(`User-agent: *
Allow: /

Sitemap: ${new URL("/sitemap.xml", site).href}
`);
}
