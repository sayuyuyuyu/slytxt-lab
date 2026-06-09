import type { APIContext } from "astro";
import { getAllEntries, getEntrySlug, type SiteEntry } from "@/lib/content";
import { getOgDate, renderOgPng } from "@/lib/og";

export async function getStaticPaths() {
  const entries = await getAllEntries();

  return entries.map((entry) => ({
    params: {
      collection: entry.collection,
      slug: getEntrySlug(entry)
    },
    props: {
      entry
    }
  }));
}

export function GET(context: APIContext) {
  const entry = context.props.entry as SiteEntry;
  const png = renderOgPng({
    title: entry.data.title,
    date: getOgDate(entry),
    category: entry.collection
  });
  const body = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;

  return new Response(body, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable"
    }
  });
}
