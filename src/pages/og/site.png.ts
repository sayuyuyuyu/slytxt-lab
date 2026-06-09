import type { APIContext } from "astro";
import { renderOgPng } from "@/lib/og";
import { site } from "@/lib/site";

export function GET(_context: APIContext) {
  const png = renderOgPng({
    title: site.title,
    date: new Date()
  });
  const body = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;

  return new Response(body, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable"
    }
  });
}
