import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { getAllWriting, getEntryDescription, getEntryDisplayTitle, getEntryPath } from "@/lib/content";
import { site } from "@/lib/site";

export async function GET(context: APIContext) {
  const articles = await getAllWriting();

  return rss({
    title: site.title,
    description: site.description,
    site: context.site ?? "https://slytxt.dev",
    items: articles.slice(0, 30).map((entry) => ({
      title: getEntryDisplayTitle(entry),
      description: getEntryDescription(entry) ?? site.description,
      pubDate: entry.data.published,
      link: getEntryPath(entry)
    })),
    customData: `<language>${site.lang}</language>`
  });
}
