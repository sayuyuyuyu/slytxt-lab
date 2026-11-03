/**
 * 誤字修正 pass の API 版。
 * ローカル版 agent.mjs（pi / codex の spawn）の置き換え。
 * プロンプトは tools/writer/prompt.mjs の fixPrompt をそのまま使う。
 *
 * ANTHROPIC_API_KEY が未設定なら pass 自体を省略し、本文をそのまま返す。
 * キーがあるのに呼び出しが失敗した場合は、現行どおり投稿を止める
 * （黙って素通りしない）。
 */
import { fixPrompt } from "../../writer/prompt.mjs";

export class FixError extends Error {}

/** モデルが全体をコードフェンスで包んで返してきた場合に剥がす（agent.mjs と同じ）。 */
export function stripCodeFence(text) {
  const trimmed = String(text ?? "").trim();
  const fenced = trimmed.match(/^```[A-Za-z0-9_-]*\n([\s\S]*?)\n```$/);
  if (fenced) return fenced[1].trim();
  return trimmed;
}

export async function fixBody({ env, draft, onLog = () => {} }) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    onLog("ANTHROPIC_API_KEY が未設定のため、誤字チェックを省略します");
    return draft.body;
  }

  const model = env.ANTHROPIC_MODEL ?? "claude-haiku-4-5";
  onLog(`誤字チェック: ${model}`);

  let response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        max_tokens: 16384,
        messages: [{ role: "user", content: fixPrompt(draft) }]
      })
    });
  } catch (error) {
    throw new FixError(`誤字チェックを呼び出せません: ${error.message}`);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new FixError(
      `誤字チェックが失敗しました (${response.status})${detail ? `: ${detail.slice(0, 500)}` : ""}`
    );
  }

  const data = await response.json();
  const text = (data.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  return stripCodeFence(text);
}
