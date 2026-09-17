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
for (const file of htmlFiles) {
  const html = await readFile(file, "utf8");
  const relative = path.relative(root, file);
  const route = "/" + relative.replace(/index\.html$/, "");
  if ((html.match(/<h1(?:\s|>)/g) ?? []).length !== 1)
    issues.push(`${relative}: expected one h1`);
  if (!html.includes('id="main-content"'))
    issues.push(`${relative}: missing skip-link target`);
  if (!html.includes('rel="canonical"'))
    issues.push(`${relative}: missing canonical`);
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
assert.deepEqual(issues, [], issues.join("\n"));
console.log(
  `Checked ${htmlFiles.length} HTML pages and ${checkedLinks} local links/assets.`,
);
