import type { APIContext } from "astro";
import { PAGE_SIZE, pageCount, paginateEntries } from "@/lib/pagination";
import {
  ARTICLE_COLLECTIONS,
  getAllArticles,
  getAllEntries,
  getArticles,
  getEntriesByTag,
  getEntryDate,
  getEntryPath,
  getProjects
} from "@/lib/content";
import type { SiteEntry } from "@/lib/content";
import { collectTags, slugifyTag, tagPath } from "@/lib/tags";
import { escapeXml } from "@/lib/xml";

function urlNode(site: URL, path: string, lastmod?: Date): string {
  const loc = new URL(path, site).href;
  return `<url><loc>${escapeXml(loc)}</loc>${lastmod ? `<lastmod>${lastmod.toISOString()}</lastmod>` : ""}</url>`;
}

/** 一覧に載るエントリの最新日。中身が入れ替われば変わるので lastmod に使う。 */
function latestDate(entries: SiteEntry[]): Date | undefined {
  let latest: Date | undefined;
  for (const entry of entries) {
    const date = getEntryDate(entry);
    if (!latest || date.getTime() > latest.getTime()) latest = date;
  }
  return latest;
}

/** ページ送り（2ページ目以降）の URL と、そのページに載るエントリの最新日。 */
function pagedUrls(entries: SiteEntry[], basePath: string) {
  return Array.from(
    { length: Math.max(0, pageCount(entries.length) - 1) },
    (_, index) => {
      const page = index + 2;
      const pageEntries = paginateEntries(entries, basePath, page, PAGE_SIZE).entries;
      return { path: `${basePath}/page/${page}/`, lastmod: latestDate(pageEntries) };
    }
  );
}

export async function GET(context: APIContext) {
  const site = context.site ?? new URL("https://slytxt.dev");
  const [entries, articles, projects, ...perCategory] = await Promise.all([
    getAllEntries(),
    getAllArticles(),
    getProjects(),
    ...ARTICLE_COLLECTIONS.map((collection) => getArticles(collection))
  ]);
  const categoryEntries = ARTICLE_COLLECTIONS.map((collection, index) => ({
    collection,
    entries: perCategory[index]
  }));
  const tags = collectTags(entries);
  const allLatest = latestDate(entries);
  // トップ・タグ一覧はサイト全体、各一覧はその一覧に載るエントリの最新日。
  // About だけは本文がページファイル内の静的な文章で、更新日を持たないため
  // lastmod を付けない。
  const staticUrls: { path: string; lastmod?: Date }[] = [
    { path: "/", lastmod: allLatest },
    ...(articles.length > 0 ? [{ path: "/articles/", lastmod: latestDate(articles) }] : []),
    ...categoryEntries.flatMap(({ collection, entries: list }) =>
      list.length > 0
        ? [{ path: `/articles/${collection}/`, lastmod: latestDate(list) }]
        : []
    ),
    // /feed/ の中身は D1 からリクエスト時に読むので、ビルド時には最終更新日を
    // 知る手立てが無い。lastmod は付けない（About と同じ扱い）。
    { path: "/feed/" },
    ...(projects.length > 0 ? [{ path: "/projects/", lastmod: latestDate(projects) }] : []),
    ...(tags.size > 0 ? [{ path: "/tags/", lastmod: allLatest }] : []),
    { path: "/about/" }
  ];

  const pageUrls = [
    ...pagedUrls(articles, "/articles"),
    ...categoryEntries.flatMap(({ collection, entries: list }) =>
      pagedUrls(list, `/articles/${collection}`)
    ),
    ...pagedUrls(projects, "/projects"),
    ...Array.from(tags.keys()).flatMap((slug) =>
      pagedUrls(getEntriesByTag(entries, slug), `/tags/${slug}`)
    )
  ];

  const tagUrls = Array.from(tags.values()).flatMap((tag) => {
    const tagEntries = getEntriesByTag(entries, slugifyTag(tag));
    return [{ path: tagPath(tag), lastmod: latestDate(tagEntries) }];
  });

  const urls = [
    ...staticUrls.map((url) => urlNode(site, url.path, url.lastmod)),
    ...pageUrls.map((url) => urlNode(site, url.path, url.lastmod)),
    ...tagUrls.map((url) => urlNode(site, url.path, url.lastmod)),
    ...entries.map((entry) => urlNode(site, getEntryPath(entry), getEntryDate(entry)))
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
