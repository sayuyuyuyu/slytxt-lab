/**
 * 整形や下書き生成を担当するエージェントCLIの起動。
 * 既定は pi。SLYTXT_AGENT=codex または SLYTXT_AGENT_CMD で差し替えられる。
 */
import { spawn } from "node:child_process";
import { repoRoot } from "./drafts.mjs";

export function agentPlan() {
  const explicit = process.env.SLYTXT_AGENT_CMD;
  if (explicit) {
    const [command, ...args] = explicit.split(/\s+/).filter(Boolean);
    return { command, args, label: explicit };
  }

  const model = process.env.SLYTXT_AGENT_MODEL;
  const name = process.env.SLYTXT_AGENT ?? "pi";

  if (name === "codex") {
    return {
      command: "codex",
      args: ["exec", "--skip-git-repo-check", "-"],
      label: `codex exec${model ? ` (${model})` : ""}`
    };
  }

  const args = ["-p", "--no-session", "--no-tools"];
  if (model) args.push("--model", model);
  return { command: "pi", args, label: `pi -p${model ? ` (${model})` : ""}` };
}

export class AgentError extends Error {}

export function runAgent({ prompt, cwd = repoRoot, onLog = () => {}, timeoutMs = 30 * 60 * 1000 }) {
  const plan = agentPlan();
  onLog(`エージェント: ${plan.label}`);

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(plan.command, plan.args, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env
      });
    } catch (error) {
      reject(new AgentError(`${plan.command} を起動できません: ${error.message}`));
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill("SIGKILL");
      reject(new AgentError(`${plan.label} が時間内に終わりませんでした`));
    }, timeoutMs);

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new AgentError(
          `${plan.command} を起動できません: ${error.message}\n` +
            `SLYTXT_AGENT か SLYTXT_AGENT_CMD で使用するCLIを指定してください。`
        )
      );
    });

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      for (const line of text.split("\n")) {
        if (line.trim()) onLog(line.trim());
      }
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new AgentError(`${plan.label} が終了コード ${code} で失敗しました\n${stderr.slice(-2000)}`));
        return;
      }
      resolve({ stdout, stderr });
    });

    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
  });
}

/** モデルが全体をコードフェンスで包んで返してきた場合に剥がす。 */
export function stripCodeFence(text) {
  const trimmed = String(text ?? "").trim();
  const fenced = trimmed.match(/^```[A-Za-z0-9_-]*\n([\s\S]*?)\n```$/);
  if (fenced) return fenced[1].trim();
  return trimmed;
}
