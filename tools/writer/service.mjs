/**
 * 執筆サーバーを launchd に登録して、Mac を再起動しても出先から使えるようにする。
 *
 *   node tools/writer/service.mjs install    # 登録して Tailscale に公開する
 *   node tools/writer/service.mjs status     # 状態と URL を出す
 *   node tools/writer/service.mjs uninstall  # 登録を外す
 *
 * macOS 専用。Tailscale が無くてもローカルでは動く。
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { repoRoot } from "./drafts.mjs";

const run = promisify(execFile);

const LABEL = "ts.slytxt.writer";
const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const configDir = path.join(os.homedir(), ".config", "slytxt-writer");
const tokenPath = path.join(configDir, "token");
const logPath = path.join(os.homedir(), "Library", "Logs", "slytxt-writer.log");

const TAILSCALE_CANDIDATES = [
  "tailscale",
  "/Applications/Tailscale.app/Contents/MacOS/tailscale",
  "/opt/homebrew/bin/tailscale",
  "/usr/local/bin/tailscale"
];

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const port = Number(option("port", process.env.PORT ?? 4326));
const httpsPort = Number(option("https-port", 8443));

async function tailscaleBin() {
  for (const candidate of TAILSCALE_CANDIDATES) {
    const found = await run("which", [candidate]).catch(() => null);
    if (found) return candidate;
  }
  return null;
}

async function tailnetHost() {
  const bin = await tailscaleBin();
  if (!bin) return null;
  const { stdout } = await run(bin, ["status", "--json"], { maxBuffer: 10 * 1024 * 1024 }).catch(() => ({ stdout: "" }));
  if (!stdout) return null;
  try {
    const status = JSON.parse(stdout);
    return String(status.Self?.DNSName ?? "").replace(/\.$/, "") || null;
  } catch {
    return null;
  }
}

async function readToken() {
  const existing = await readFile(tokenPath, "utf8").catch(() => "");
  if (existing.trim()) return existing.trim();
  const token = randomBytes(16).toString("hex");
  await mkdir(configDir, { recursive: true });
  await writeFile(tokenPath, `${token}\n`, "utf8");
  await chmod(tokenPath, 0o600);
  return token;
}

function plist(token) {
  const searchPath = [
    path.dirname(process.execPath),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(os.homedir(), ".local", "bin"),
    path.join(os.homedir(), ".hermes", "node", "bin"),
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin"
  ].join(":");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(process.execPath)}</string>
    <string>${xml(path.join(repoRoot, "tools", "writer", "server.mjs"))}</string>
    <string>--host</string>
    <string>${xml(port)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(repoRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xml(searchPath)}</string>
    <key>HOME</key>
    <string>${xml(os.homedir())}</string>
    <key>SLYTXT_TOKEN</key>
    <string>${xml(token)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${xml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(logPath)}</string>
</dict>
</plist>
`;
}

async function launchctl(args) {
  return run("launchctl", args).catch((error) => ({ stdout: "", stderr: String(error) }));
}

async function install() {
  const token = await readToken();
  await mkdir(path.dirname(plistPath), { recursive: true });
  await writeFile(plistPath, plist(token), "utf8");
  await chmod(plistPath, 0o600);

  const domain = `gui/${process.getuid()}`;
  await launchctl(["bootout", domain, plistPath]);
  const result = await launchctl(["bootstrap", domain, plistPath]);
  if (result.stderr && !/already (loaded|bootstrapped)/i.test(result.stderr)) {
    console.error(result.stderr.trim());
  }
  await launchctl(["enable", `${domain}/${LABEL}`]);
  // bootstrap だけだと起動しないことがあるので明示的に起こす。
  await launchctl(["kickstart", "-k", `${domain}/${LABEL}`]);

  const bin = await tailscaleBin();
  if (bin) {
    const serve = await run(bin, ["serve", "--bg", `--https=${httpsPort}`, `http://127.0.0.1:${port}`]).catch(
      (error) => ({ stderr: String(error.stdout ?? "") + String(error.stderr ?? error) })
    );
    if (serve.stderr?.trim()) console.log(serve.stderr.trim());
  } else {
    console.log("Tailscale が見つかりません。ローカルのみで起動します。");
  }

  await sleep(1500);
  await status();
}

async function status() {
  const domain = `gui/${process.getuid()}`;
  const listed = await run("launchctl", ["print", `${domain}/${LABEL}`]).catch(() => null);
  const running = Boolean(listed);
  const token = (await readFile(tokenPath, "utf8").catch(() => "")).trim();
  const host = await tailnetHost();

  console.log(`サービス: ${running ? "登録済み" : "未登録"} (${LABEL})`);
  console.log(`  ローカル: http://127.0.0.1:${port}/${token ? `?token=${token}` : ""}`);
  if (host) {
    console.log(`  出先から: https://${host}:${httpsPort}/${token ? `?token=${token}` : ""}`);
  } else {
    console.log("  出先から: Tailscale のホスト名が取れませんでした");
  }
  console.log(`  ログ: ${logPath}`);
  const health = await fetch(`http://127.0.0.1:${port}/api/meta${token ? `?token=${token}` : ""}`)
    .then((res) => `HTTP ${res.status}`)
    .catch(() => "応答なし");
  console.log(`  応答: ${health}`);
}

async function uninstall() {
  const domain = `gui/${process.getuid()}`;
  await launchctl(["bootout", domain, plistPath]);
  await rm(plistPath, { force: true });

  const bin = await tailscaleBin();
  if (bin) {
    await run(bin, ["serve", `--https=${httpsPort}`, "off"]).catch(() => null);
  }
  console.log("登録を外しました。token は ~/.config/slytxt-writer/token に残しています。");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** plist は XML なので、パスに & や < が入っても壊れないようにする。 */
function xml(value) {
  return String(value).replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]
  );
}

const command = process.argv[2] ?? "status";
if (command === "install") await install();
else if (command === "uninstall") await uninstall();
else if (command === "status") await status();
else {
  console.error("使い方: node tools/writer/service.mjs [install|status|uninstall]");
  process.exit(1);
}
