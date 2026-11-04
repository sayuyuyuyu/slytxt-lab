/** Verify generated routes and links without another dependency. */
import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(process.argv[2] ?? "dist");
async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await files(name)));
    else result.push(name);
  }
  return result;
}
const htmlFiles = (await files(root)).filter((name) => name.endsWith(".html"));
assert.ok(htmlFiles.length > 0, "Build the site before checking output");
const issues = [];
let checkedLinks = 0;
let checkedImages = 0;
let checkedXmlUrls = 0;
function unescapeXml(value) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}
async function distFileExists(pathname) {
  let target = path.join(root, pathname);
  try {
    if ((await stat(target)).isDirectory())
      target = path.join(target, "index.html");
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
}
for (const file of htmlFiles) {
  const html = await readFile(file, "utf8");
  const relative = path.relative(root, file);
  const route = "/" + relative.replace(/index\.html$/, "");
  if ((html.match(/<h1(?:\s|>)/g) ?? []).length !== 1)
    issues.push(`${relative}: expected one h1`);
  if (!html.includes('id="main-content"'))
    issues.push(`${relative}: missing skip-link target`);
  if (relative === "404.html") {
    if (html.includes('rel="canonical"'))
      issues.push(`${relative}: unexpected canonical`);
    if (html.includes('property="og:url"'))
      issues.push(`${relative}: unexpected og:url`);
  } else if (!html.includes('rel="canonical"'))
    issues.push(`${relative}: missing canonical`);
  for (const tag of html.matchAll(
    /<meta\b[^>]*\b(?:property="og:image"|name="twitter:image")[^>]*>/g,
  )) {
    const value = tag[0].match(/\bcontent="([^"]+)"/)?.[1];
    if (!value) {
      issues.push(`${relative}: og:image / twitter:image without content`);
      continue;
    }
    let decoded;
    try {
      decoded = decodeURIComponent(new URL(value).pathname);
    } catch {
      issues.push(`${relative}: invalid og image URL ${value}`);
      continue;
    }
    try {
      if (!(await stat(path.join(root, decoded))).isFile())
        throw new Error("not a file");
      checkedImages++;
    } catch {
      issues.push(`${relative}: missing og image ${value}`);
    }
  }
  for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const value = match[1].replaceAll("&amp;", "&");
    if (/^(?:[a-z]+:|\/\/|#)/i.test(value)) continue;
    const url = new URL(value, `https://local.test${route}`);
    let decoded;
    try {
      decoded = decodeURIComponent(url.pathname);
    } catch {
      issues.push(`${relative}: invalid URL ${value}`);
      continue;
    }
    let target = path.join(root, decoded);
    try {
      if ((await stat(target)).isDirectory())
        target = path.join(target, "index.html");
      if (!(await stat(target)).isFile()) throw new Error("not a file");
      checkedLinks++;
    } catch {
      issues.push(`${relative}: missing ${value}`);
    }
  }
}
let sitemap = null;
try {
  sitemap = await readFile(path.join(root, "sitemap.xml"), "utf8");
} catch {
  issues.push("sitemap.xml: missing file");
}
if (sitemap !== null) {
  if (!sitemap.includes("<urlset")) issues.push("sitemap.xml: missing urlset");
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  if (locs.length === 0) issues.push("sitemap.xml: no loc entries");
  for (const raw of locs) {
    const value = unescapeXml(raw.trim());
    let decoded;
    try {
      decoded = decodeURIComponent(new URL(value).pathname);
    } catch {
      issues.push(`sitemap.xml: invalid loc URL ${value}`);
      continue;
    }
    if (await distFileExists(decoded)) checkedXmlUrls++;
    else issues.push(`sitemap.xml: missing ${value}`);
  }
}
let rssXml = null;
try {
  rssXml = await readFile(path.join(root, "rss.xml"), "utf8");
} catch {
  issues.push("rss.xml: missing file");
}
if (rssXml !== null) {
  if (!rssXml.includes("<channel")) issues.push("rss.xml: missing channel");
  const items = [...rssXml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  if (items.length === 0) issues.push("rss.xml: no item entries");
  for (const item of items) {
    const link = item[1].match(/<link>([^<]+)<\/link>/)?.[1];
    if (!link) {
      issues.push("rss.xml: item without link");
      continue;
    }
    const value = unescapeXml(link.trim());
    let decoded;
    try {
      decoded = decodeURIComponent(new URL(value).pathname);
    } catch {
      issues.push(`rss.xml: invalid item link ${value}`);
      continue;
    }
    if (await distFileExists(decoded)) checkedXmlUrls++;
    else issues.push(`rss.xml: missing ${value}`);
  }
}
assert.deepEqual(issues, [], issues.join("\n"));
console.log(
  `Checked ${htmlFiles.length} HTML pages, ${checkedLinks} local links/assets, ${checkedImages} og images and ${checkedXmlUrls} XML urls.`,
);
