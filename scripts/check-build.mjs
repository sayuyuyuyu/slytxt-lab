/** Verify generated routes and links without another dependency. */
import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(process.argv[2] ?? "dist");
const SITE_ORIGIN = "https://slytxt.dev";
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
let checkedTitles = 0;
let checkedCanonicals = 0;
let checkedDescriptions = 0;
let checkedSocial = 0;
let checkedLinks = 0;
let checkedFragments = 0;
let checkedImages = 0;
let checkedXmlUrls = 0;
let checkedPagefindAssets = 0;
let checkedRobotsRules = 0;
let checkedRedirects = 0;
let checkedNoindex = 0;
let checkedStructured = 0;
let checkedImgAlts = 0;
let checkedSitemapPages = 0;
let checkedRssMeta = 0;
let checkedRssItems = 0;
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
const idsByFile = new Map();
async function idsIn(file) {
  if (!idsByFile.has(file)) {
    const content = await readFile(file, "utf8");
    idsByFile.set(
      file,
      new Set([...content.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])),
    );
  }
  return idsByFile.get(file);
}
function decodeFragment(hash) {
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return hash.slice(1);
  }
}
for (const file of htmlFiles) {
  const html = await readFile(file, "utf8");
  const relative = path.relative(root, file);
  const route = "/" + relative.replace(/index\.html$/, "");
  if ((html.match(/<h1(?:\s|>)/g) ?? []).length !== 1)
    issues.push(`${relative}: expected one h1`);
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1]?.trim();
  if (title) checkedTitles++;
  else issues.push(`${relative}: missing or empty title`);
  const descriptionTag = html.match(/<meta\b[^>]*\bname="description"[^>]*>/)?.[0];
  const description = descriptionTag?.match(/\bcontent="([^"]*)"/)?.[1]?.trim();
  if (description) checkedDescriptions++;
  else issues.push(`${relative}: missing or empty meta description`);
  const metaContent = (attr, name) => {
    const tag = html.match(
      new RegExp(`<meta\\b[^>]*\\b${attr}="${name}"[^>]*>`),
    )?.[0];
    return tag?.match(/\bcontent="([^"]*)"/)?.[1]?.trim();
  };
  const ogImageUrl = metaContent("property", "og:image");
  let ogImagePath = "";
  try {
    ogImagePath = new URL(ogImageUrl).pathname;
  } catch {}
  // The default OG image shows only the site name and description, so its
  // alt must be the site name, not the page title.
  const imageAlt = ogImagePath === "/og/site.png" ? "slytxt.lab" : title;
  for (const [attr, name, expected] of [
    ["property", "og:title", title],
    ["property", "og:description", description],
    ["name", "twitter:title", title],
    ["name", "twitter:description", description],
    ["property", "og:image:alt", imageAlt],
    ["name", "twitter:image:alt", imageAlt],
    ["property", "og:image:width", "1200"],
    ["property", "og:image:height", "630"],
    ["property", "og:image:type", "image/png"],
    ["name", "twitter:card", "summary_large_image"],
  ]) {
    const value = metaContent(attr, name);
    if (!value) issues.push(`${relative}: missing or empty ${name}`);
    else if (expected && value !== expected)
      issues.push(`${relative}: ${name} does not match ${expected}`);
    else checkedSocial++;
  }
  const jsonLdItems = [];
  for (const match of html.matchAll(/<script\b[^>]*\btype="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const parsed = JSON.parse(match[1]);
      jsonLdItems.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch {
      issues.push(`${relative}: invalid JSON-LD`);
    }
  }
  const websiteLd = jsonLdItems.find((item) => item?.["@type"] === "WebSite");
  if (!websiteLd) issues.push(`${relative}: missing WebSite JSON-LD`);
  else if (!websiteLd.name || websiteLd.url !== `${SITE_ORIGIN}/`)
    issues.push(`${relative}: WebSite JSON-LD missing name or url`);
  else checkedStructured++;
  if (/^projects\/[^/]+\/index\.html$/.test(relative)) {
    const workLd = jsonLdItems.find((item) => item?.["@type"] === "CreativeWork");
    if (!workLd) issues.push(`${relative}: missing CreativeWork JSON-LD`);
    else {
      const missingKeys = ["headline", "datePublished", "dateModified", "image", "author"].filter((key) => !workLd[key]);
      if (missingKeys.length > 0)
        issues.push(`${relative}: CreativeWork JSON-LD missing ${missingKeys.join(", ")}`);
      else if (Number.isNaN(Date.parse(workLd.datePublished)) || Number.isNaN(Date.parse(workLd.dateModified)))
        issues.push(`${relative}: CreativeWork JSON-LD has invalid dates`);
      else checkedStructured++;
    }
  }
  if (relative === "about/index.html") {
    const profileLd = jsonLdItems.find((item) => item?.["@type"] === "ProfilePage");
    if (!profileLd) issues.push(`${relative}: missing ProfilePage JSON-LD`);
    else if (profileLd.mainEntity?.["@type"] !== "Person" || !profileLd.mainEntity?.name)
      issues.push(`${relative}: ProfilePage JSON-LD missing Person mainEntity`);
    else checkedStructured++;
  }
  if (metaContent("property", "og:type") === "article") {
    const postingLd = jsonLdItems.find((item) => item?.["@type"] === "BlogPosting");
    if (!postingLd) issues.push(`${relative}: missing BlogPosting JSON-LD`);
    else {
      const missingKeys = ["headline", "datePublished", "dateModified", "image", "author"].filter((key) => !postingLd[key]);
      if (missingKeys.length > 0)
        issues.push(`${relative}: BlogPosting JSON-LD missing ${missingKeys.join(", ")}`);
      else if (Number.isNaN(Date.parse(postingLd.datePublished)) || Number.isNaN(Date.parse(postingLd.dateModified)))
        issues.push(`${relative}: BlogPosting JSON-LD has invalid dates`);
      else checkedStructured++;
    }
  }
  // BreadcrumbList must match the visible breadcrumbs, if any.
  const breadcrumbNav = html.match(/<nav\b[^>]*\bclass="breadcrumbs"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
  const breadcrumbLd = jsonLdItems.find((item) => item?.["@type"] === "BreadcrumbList");
  if (breadcrumbNav && !breadcrumbLd) {
    issues.push(`${relative}: missing BreadcrumbList JSON-LD`);
  } else if (!breadcrumbNav && breadcrumbLd) {
    issues.push(`${relative}: BreadcrumbList JSON-LD without breadcrumbs`);
  } else if (breadcrumbNav && breadcrumbLd) {
    const decodeHtml = (value) =>
      value
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", '"')
        .replaceAll("&#39;", "'")
        .replaceAll("&apos;", "'")
        .replaceAll("&amp;", "&");
    const displayed = [];
    for (const m of breadcrumbNav.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([^<]*)<\/a>|<span\b[^>]*\baria-current="page"[^>]*>([^<]*)<\/span>/g)) {
      if (m[1] !== undefined) displayed.push({ href: m[1], label: decodeHtml(m[2].trim()) });
      else displayed.push({ label: decodeHtml(m[3].trim()) });
    }
    const elements = Array.isArray(breadcrumbLd.itemListElement) ? breadcrumbLd.itemListElement : [];
    if (displayed.length === 0) {
      issues.push(`${relative}: breadcrumbs without items`);
    } else if (elements.length !== displayed.length) {
      issues.push(`${relative}: BreadcrumbList has ${elements.length} items, breadcrumbs show ${displayed.length}`);
    } else {
      let breadcrumbOk = true;
      for (let i = 0; i < displayed.length; i++) {
        const el = elements[i];
        const shown = displayed[i];
        if (el?.["@type"] !== "ListItem" || el?.position !== i + 1 || el?.name !== shown.label) {
          issues.push(`${relative}: BreadcrumbList item ${i + 1} does not match breadcrumbs`);
          breadcrumbOk = false;
          break;
        }
        const isLast = i === displayed.length - 1;
        if (isLast) {
          if (el.item !== undefined) {
            issues.push(`${relative}: BreadcrumbList last item must not have item URL`);
            breadcrumbOk = false;
            break;
          }
        } else {
          const expectedItem = shown.href ? new URL(shown.href, SITE_ORIGIN).href : undefined;
          if (!expectedItem || el.item !== expectedItem) {
            issues.push(`${relative}: BreadcrumbList item ${i + 1} url does not match breadcrumbs`);
            breadcrumbOk = false;
            break;
          }
        }
      }
      if (breadcrumbOk) checkedStructured++;
    }
  }
  if (!html.includes('id="main-content"'))
    issues.push(`${relative}: missing skip-link target`);
  const robotsContent = metaContent("name", "robots");
  const expectsNoindex = relative === "404.html" || relative === "search/index.html";
  if (expectsNoindex) {
    if (robotsContent === "noindex") checkedNoindex++;
    else issues.push(`${relative}: missing noindex robots meta`);
  } else if (robotsContent === "noindex") {
    issues.push(`${relative}: unexpected noindex robots meta`);
  } else checkedNoindex++;
  if (relative === "404.html") {
    if (html.includes('rel="canonical"'))
      issues.push(`${relative}: unexpected canonical`);
    if (html.includes('property="og:url"'))
      issues.push(`${relative}: unexpected og:url`);
  } else {
    const expectedCanonical = new URL(route, SITE_ORIGIN).href;
    const canonicalTag = html.match(/<link\b[^>]*\brel="canonical"[^>]*>/)?.[0];
    const canonicalHref = canonicalTag?.match(/\bhref="([^"]*)"/)?.[1];
    if (!canonicalHref) issues.push(`${relative}: missing canonical`);
    else if (canonicalHref !== expectedCanonical)
      issues.push(
        `${relative}: canonical ${canonicalHref} does not match ${expectedCanonical}`,
      );
    else checkedCanonicals++;
    const ogUrlTag = html.match(/<meta\b[^>]*\bproperty="og:url"[^>]*>/)?.[0];
    const ogUrl = ogUrlTag?.match(/\bcontent="([^"]*)"/)?.[1];
    if (!ogUrl) issues.push(`${relative}: missing og:url`);
    else if (ogUrl !== expectedCanonical)
      issues.push(
        `${relative}: og:url ${ogUrl} does not match ${expectedCanonical}`,
      );
    else checkedCanonicals++;
  }
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
  for (const tag of html.matchAll(/<img\b[^>]*>/g)) {
    // An empty alt is fine for decorative images; only a missing
    // attribute means the alternative text was dropped entirely.
    if (/\balt="[^"]*"/.test(tag[0])) checkedImgAlts++;
    else issues.push(`${relative}: img without alt attribute`);
  }
  for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const value = match[1].replaceAll("&amp;", "&");
    if (value.startsWith("#")) {
      const fragment = decodeFragment(value);
      if (fragment) {
        if ((await idsIn(file)).has(fragment)) checkedFragments++;
        else issues.push(`${relative}: missing fragment target ${value}`);
      }
      continue;
    }
    let url;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) {
      try {
        url = new URL(value, "https://local.test");
      } catch {
        continue;
      }
      if (url.origin !== SITE_ORIGIN) continue;
    } else {
      url = new URL(value, `https://local.test${route}`);
    }
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
      const fragment = url.hash ? decodeFragment(url.hash) : "";
      if (fragment && target.endsWith(".html")) {
        if ((await idsIn(target)).has(fragment)) checkedFragments++;
        else issues.push(`${relative}: missing fragment target ${value}`);
      }
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
  const locUrls = new Set();
  for (const raw of locs) {
    const value = unescapeXml(raw.trim());
    let decoded;
    try {
      decoded = decodeURIComponent(new URL(value).pathname);
      locUrls.add(new URL(value).href);
    } catch {
      issues.push(`sitemap.xml: invalid loc URL ${value}`);
      continue;
    }
    if (await distFileExists(decoded)) checkedXmlUrls++;
    else issues.push(`sitemap.xml: missing ${value}`);
  }
  for (const file of htmlFiles) {
    const relative = path.relative(root, file);
    // noindex pages (404 and Search) are intentionally left out of the sitemap.
    if (relative === "404.html" || relative === "search/index.html") continue;
    // Listing pages with no entries are also left out on purpose (see the
    // count-based staticPaths in src/pages/sitemap.xml.ts): they render the
    // EmptyState component instead of any content.
    const html = await readFile(file, "utf8");
    if (html.includes('class="empty-state"')) continue;
    const route = "/" + relative.replace(/index\.html$/, "");
    const expected = new URL(route, SITE_ORIGIN).href;
    if (locUrls.has(expected)) checkedSitemapPages++;
    else issues.push(`sitemap.xml: public page not listed ${expected}`);
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
  // Channel metadata lives before the first item.
  const channelHead = rssXml.split("<item>")[0];
  const language = channelHead.match(/<language>([^<]+)<\/language>/)?.[1]?.trim();
  if (language === "ja") checkedRssMeta++;
  else issues.push(`rss.xml: expected language ja, got ${language ?? "none"}`);
  if (items.length > 0) {
    const lastBuildDate = channelHead
      .match(/<lastBuildDate>([^<]+)<\/lastBuildDate>/)?.[1]
      ?.trim();
    if (!lastBuildDate) issues.push("rss.xml: missing lastBuildDate");
    else if (Number.isNaN(Date.parse(lastBuildDate)))
      issues.push(`rss.xml: invalid lastBuildDate ${lastBuildDate}`);
    else checkedRssMeta++;
  }
  const atomLink = channelHead.match(/<atom:link\b[^>]*>/)?.[0];
  const atomHref = atomLink?.match(/\bhref="([^"]*)"/)?.[1];
  const atomRel = atomLink?.match(/\brel="([^"]*)"/)?.[1];
  if (!atomLink) issues.push("rss.xml: missing atom:link");
  else if (atomHref !== `${SITE_ORIGIN}/rss.xml` || atomRel !== "self")
    issues.push("rss.xml: atom:link is not a self reference to /rss.xml");
  else checkedRssMeta++;
  for (const item of items) {
    const body = item[1];
    const itemTitle = body.match(/<title>([^<]*)<\/title>/)?.[1]?.trim();
    if (itemTitle) checkedRssItems++;
    else issues.push("rss.xml: item without title");
    const itemDescription = body
      .match(/<description>([^<]*)<\/description>/)?.[1]
      ?.trim();
    if (itemDescription) checkedRssItems++;
    else issues.push("rss.xml: item without description");
    const pubDate = body.match(/<pubDate>([^<]*)<\/pubDate>/)?.[1]?.trim();
    if (!pubDate) issues.push("rss.xml: item without pubDate");
    else if (Number.isNaN(Date.parse(pubDate)))
      issues.push(`rss.xml: invalid item pubDate ${pubDate}`);
    else checkedRssItems++;
    const guid = body.match(/<guid\b[^>]*>([^<]*)<\/guid>/)?.[1]?.trim();
    if (guid) checkedRssItems++;
    else issues.push("rss.xml: item without guid");
    const categories = [...body.matchAll(/<category>([^<]+)<\/category>/g)]
      .map((match) => match[1].trim())
      .filter(Boolean);
    if (categories.length > 0) checkedRssItems++;
    else issues.push("rss.xml: item without category");
    const link = body.match(/<link>([^<]+)<\/link>/)?.[1];
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
let robotsTxt = null;
try {
  robotsTxt = await readFile(path.join(root, "robots.txt"), "utf8");
} catch {
  issues.push("robots.txt: missing file");
}
if (robotsTxt !== null) {
  const lines = robotsTxt.split(/\r?\n/).map((line) => line.trim());
  const sitemapLine = lines.find((line) => line.startsWith("Sitemap:"));
  let sitemapOk = false;
  if (sitemapLine) {
    try {
      const url = new URL(sitemapLine.slice("Sitemap:".length).trim());
      sitemapOk = url.origin === SITE_ORIGIN && url.pathname === "/sitemap.xml";
    } catch {
      sitemapOk = false;
    }
  }
  if (sitemapOk) checkedRobotsRules++;
  else issues.push(`robots.txt: missing Sitemap: ${SITE_ORIGIN}/sitemap.xml`);
  for (const rule of ["Disallow: /bm/", "Disallow: /api/"]) {
    if (lines.includes(rule)) checkedRobotsRules++;
    else issues.push(`robots.txt: missing ${rule}`);
  }
}
let redirectsTxt = null;
try {
  redirectsTxt = await readFile(path.join(root, "_redirects"), "utf8");
} catch {
  issues.push("_redirects: missing file");
}
if (redirectsTxt !== null) {
  for (const rawLine of redirectsTxt.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const target = line.split(/\s+/)[1];
    if (!target) {
      issues.push(`_redirects: line without target: ${line}`);
      continue;
    }
    // Dynamic targets cannot be resolved to a single file in dist.
    if (target.includes(":splat") || target.includes("*")) continue;
    let pathname = target;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
      try {
        const url = new URL(target);
        if (url.origin !== SITE_ORIGIN) continue;
        pathname = url.pathname;
      } catch {
        issues.push(`_redirects: invalid target ${target}`);
        continue;
      }
    }
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      issues.push(`_redirects: invalid target ${target}`);
      continue;
    }
    if (await distFileExists(decoded)) checkedRedirects++;
    else issues.push(`_redirects: missing redirect target ${target}`);
  }
  if (checkedRedirects === 0)
    issues.push("_redirects: no static redirect targets checked");
}
for (const asset of [
  "pagefind/pagefind-ui.js",
  "pagefind/pagefind-ui.css",
  "pagefind/pagefind.js",
  "pagefind/pagefind-entry.json",
  "pagefind/wasm.unknown.pagefind",
]) {
  try {
    if (!(await stat(path.join(root, asset))).isFile()) throw new Error("not a file");
    checkedPagefindAssets++;
  } catch {
    issues.push(asset + ": missing file");
  }
}
for (const [directory, suffix] of [
  ["pagefind/index", ".pf_index"],
  ["pagefind/fragment", ".pf_fragment"],
]) {
  let names = [];
  try {
    names = await readdir(path.join(root, directory));
  } catch {
    names = [];
  }
  if (names.some((name) => name.endsWith(suffix))) checkedPagefindAssets++;
  else issues.push(`${directory}: missing ${suffix} file`);
}
assert.deepEqual(issues, [], issues.join("\n"));
console.log(
  `Checked ${htmlFiles.length} HTML pages, ${checkedTitles} titles, ${checkedDescriptions} descriptions, ${checkedSocial} social metas, ${checkedCanonicals} canonical urls, ${checkedLinks} local links/assets, ${checkedFragments} fragment links, ${checkedImages} og images, ${checkedImgAlts} img alts, ${checkedXmlUrls} XML urls, ${checkedSitemapPages} sitemap pages, ${checkedRssMeta} rss channel metas, ${checkedRssItems} rss item fields, ${checkedPagefindAssets} Pagefind assets, ${checkedRobotsRules} robots rules, ${checkedRedirects} redirects, ${checkedNoindex} noindex checks and ${checkedStructured} structured data.`,
);
