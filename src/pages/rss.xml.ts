import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { formatRfc822 } from "@/lib/bookmarks/format";
import { getAllWriting, getEntryDate, getEntryDescription, getEntryDisplayTitle, getEntryPath } from "@/lib/content";
import { categoryLabels, site } from "@/lib/site";

export async function GET(context: APIContext) {
  const articles = await getAllWriting();
  const items = articles.slice(0, 30);
  const siteUrl = context.site ?? "https://slytxt.dev";
  const lastBuildDate =
    items.length > 0
      ? formatRfc822(
          new Date(Math.max(...items.map((entry) => getEntryDate(entry).getTime()))).toISOString()
        )
      : null;

  return rss({
    title: site.title,
    description: site.description,
    site: siteUrl,
    xmlns: { atom: "http://www.w3.org/2005/Atom" },
    items: items.map((entry) => ({
      title: getEntryDisplayTitle(entry),
      description: getEntryDescription(entry) ?? site.description,
      // @astrojs/rss は pubDate を Date から toUTCString() で GMT 表記にしてしまうため、
      // 時刻そのものは変えずに customData で formatRfc822 の +0900 表記を渡し、
      // lastBuildDate とブックマーク RSS の表記にそろえる。
      customData: `<pubDate>${formatRfc822(entry.data.published.toISOString())}</pubDate>`,
      link: getEntryPath(entry),
      categories: [...new Set([categoryLabels[entry.collection], ...entry.data.tags])]
    })),
    customData:
      `<language>${site.lang}</language>` +
      (lastBuildDate ? `<lastBuildDate>${lastBuildDate}</lastBuildDate>` : "") +
      `<atom:link href="${new URL("/rss.xml", siteUrl).href}" rel="self" type="application/rss+xml"/>`
  });
}
