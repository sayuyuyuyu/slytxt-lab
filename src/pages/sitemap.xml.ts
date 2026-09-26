import type { APIContext } from "astro";
import { pageCount } from "@/lib/pagination";
import {
  getAllArticles,
  getAllEntries,
  getArticles,
  getEntryDate,
  getEntryPath,
  getNotes
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
  const [entries, articles, tech, journal, notes] = await Promise.all([
    getAllEntries(),
    getAllArticles(),
    getArticles("tech"),
    getArticles("journal"),
    getNotes()
  ]);
  const tags = collectTags(entries);
  const staticPaths = [
    "/",
    "/articles/",
    "/articles/tech/",
    "/articles/journal/",
    "/notes/",
    "/projects/",
    "/tags/",
    "/about/",
    "/rss.xml"
  ];

  const paged = (count: number, base: string) =>
    Array.from(
      { length: Math.max(0, pageCount(count) - 1) },
      (_, index) => `${base}/page/${index + 2}/`
    );

  const pagePaths = [
    ...paged(articles.length, "/articles"),
    ...paged(tech.length, "/articles/tech"),
    ...paged(journal.length, "/articles/journal"),
    ...paged(notes.length, "/notes")
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
