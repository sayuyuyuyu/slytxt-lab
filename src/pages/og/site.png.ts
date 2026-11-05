import type { APIContext } from "astro";
import { renderOgPng } from "@/lib/og";
import { site } from "@/lib/site";

export function GET(_context: APIContext) {
  const png = renderOgPng({
    title: site.name
  });
  const body = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;

  // 静的ビルドで dist のファイルとして配信されるため、ここの Response
  // ヘッダーは実際の配信には反映されない。OG 画像はタイトル変更時も
  // 同じ URL のまま差し替わるので、長期の immutable キャッシュは付けず、
  // 配信側（Cloudflare Pages 既定の max-age=14400, must-revalidate）に任せる。
  return new Response(body, {
    headers: {
      "Content-Type": "image/png"
    }
  });
}
