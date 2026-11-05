import { escapeHtml } from "../html.ts";

/** ブックマーク認可（開始側と完了側）で共通の結果画面。テーマ・フォント・skip link を本体にそろえる。 */
export function oauthResultPage(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#05070f">
<title>${escapeHtml(title)}</title>
<script>try{var isLight=localStorage.getItem("theme")==="light";document.documentElement.classList.toggle("light",isLight);document.querySelector('meta[name="theme-color"]').setAttribute("content",isLight?"#eef3fb":"#05070f")}catch(e){}</script>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700&display=swap" rel="stylesheet">
<style>body{margin:0;background:#05070f;color:#d9e6f7;font:16px/1.9 "Zen Kaku Gothic New","Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic","YuGothic",sans-serif}
.skip-link{position:absolute;top:12px;left:16px;z-index:60;padding:8px 16px;background:#0b1220;border:1px solid #4cc9f0;transform:translateY(-180%)}
.skip-link:focus{transform:translateY(0)}
main{max-width:640px;margin:0 auto;padding:64px 20px}main:focus{outline:none}h1{font-size:1.4rem;font-weight:400;margin:0 0 16px}a{color:#4cc9f0}
p{margin:0 0 12px}
:root.light body{background:#eef3fb;color:#0b1220}
:root.light .skip-link{background:#e2eaf6;border-color:#0b63c4}
:root.light a{color:#0b63c4}
@media print{body{background:#ffffff;color:#0b1220}a{color:#0b63c4}.skip-link{display:none!important}}</style></head>
<body><a class="skip-link" href="#main-content">Skip to content</a><main id="main-content" tabindex="-1"><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex" } }
  );
}
