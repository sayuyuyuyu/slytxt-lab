import type { APIContext } from "astro";
import {
  getAllEntries,
  getArticles,
  getEntryDate,
  getEntryPath
} from "@/lib/content";
import { collectTags, tagPath } from "@/lib/tags";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function urlNode(site: URL, path: string, lastmod?: Date): string {
  const loc = new URL(path, site).href;
  return `<url><loc>${escapeXml(loc)}</loc>${lastmod ? `<lastmod>${lastmod.toISOString()}</lastmod>` : ""}</url>`;
}

export async function GET(context: APIContext) {
  const site = context.site ?? new URL("https://slytxt.dev");
  const [entries, tech, life] = await Promise.all([
    getAllEntries(),
    getArticles("tech"),
    getArticles("life")
  ]);
  const tags = collectTags(entries);
  const staticPaths = ["/", "/tech/", "/life/", "/projects/", "/search/", "/about/", "/rss.xml"];
  const pagePaths = [
    ...Array.from({ length: Math.max(0, Math.ceil(tech.length / 10) - 1) }, (_, index) => `/tech/page/${index + 2}/`),
    ...Array.from({ length: Math.max(0, Math.ceil(life.length / 10) - 1) }, (_, index) => `/life/page/${index + 2}/`)
  ];

  const urls = [
    ...staticPaths.map((path) => urlNode(site, path)),
    ...pagePaths.map((path) => urlNode(site, path)),
    ...entries.map((entry) => urlNode(site, getEntryPath(entry), getEntryDate(entry))),
    ...Array.from(tags.values()).map((tag) => urlNode(site, tagPath(tag)))
  ];

  return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>`, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8"
    }
  });
}
