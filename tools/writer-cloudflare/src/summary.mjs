/**
 * ディスクリプション用の AI 要約（OpenCode Go 経由）。
 *
 * 公開フローと、公開パネルの候補生成（POST /api/drafts/:id/summary）から使う。
 * 要約は「あれば使う」位置づけで、生成できない場合はすべて空文字を返し、
 * 呼び出し側が抜粋フォールバックに倒す（公開自体は止めない）。
 *
 * 設定はすべて差し替え可能:
 * - API キー: secret `OPENCODE_GO_API_KEY`。未設定なら要約は使わない。
 * - エンドポイント: var `OPENCODE_GO_API_URL`（OpenAI 互換の chat completions URL）。
 * - モデル: var `OPENCODE_GO_MODEL`。
 *
 * 仕様は OpenCode 公式ドキュメント（Go の Endpoints）で確認した。
 * https://opencode.ai/docs/go/
 * chat completions 系のモデルは
 * https://opencode.ai/inference/go/openai/v1/chat/completions へ
 * Authorization: Bearer <key> で送る。モデルごとにネイティブ API は違うが、
 * 公式ドキュメント上、テキストモデルは他形式の API でも Console が変換して使える。
 */
import { plainText, truncateText } from "./markdown.mjs";

export const SUMMARY_DEFAULT_URL =
  "https://opencode.ai/inference/go/openai/v1/chat/completions";
// 要約は短文生成なので、枠が広く高速な flash 系を既定にする。
export const SUMMARY_DEFAULT_MODEL = "glm-5.3-flash";

const SUMMARY_TIMEOUT_MS = 25_000;
const SUMMARY_MAX_BODY_CHARS = 6_000;
const SUMMARY_MAX_CHARS = 200;

const SYSTEM_PROMPT =
  "あなたは個人ブログの記事に付ける説明文（ディスクリプション）を作る担当です。" +
  "渡された本文を日本語で1〜2文、合計120文字以内に要約してください。" +
  "本文に書かれていないことは足さないでください。" +
  "宣伝文句や呼びかけ、感想の付け足しはしないでください。" +
  "要約文だけを出力し、引用符や前置きは付けないでください。";

/** env から要約の設定を読む。キーが無ければ null（要約は使わない）。 */
export function summaryConfig(env) {
  const apiKey =
    typeof env?.OPENCODE_GO_API_KEY === "string" ? env.OPENCODE_GO_API_KEY.trim() : "";
  if (!apiKey) return null;
  const url =
    typeof env?.OPENCODE_GO_API_URL === "string" && env.OPENCODE_GO_API_URL.trim()
      ? env.OPENCODE_GO_API_URL.trim()
      : SUMMARY_DEFAULT_URL;
  const model =
    typeof env?.OPENCODE_GO_MODEL === "string" && env.OPENCODE_GO_MODEL.trim()
      ? env.OPENCODE_GO_MODEL.trim()
      : SUMMARY_DEFAULT_MODEL;
  return { apiKey, url, model };
}

/** モデルの応答を、説明文として使える形に整える。 */
export function cleanSummary(raw) {
  let text = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (/^「.*」$/.test(text) || /^".*"$/.test(text)) text = text.slice(1, -1).trim();
  return truncateText(text, SUMMARY_MAX_CHARS);
}

/**
 * 本文から要約を生成する。キーが無い・本文が空・通信や応答の異常など、
 * 生成できない場合はすべて空文字を返す（呼び出し側がフォールバックする）。
 */
export async function generateSummary(env, { title, body } = {}, fetchImpl = fetch) {
  const config = summaryConfig(env);
  if (!config) return "";
  const text = plainText(String(body ?? "")).replace(/\s+/g, " ").trim();
  if (!text) return "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS);
  try {
    const response = await fetchImpl(config.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
        // Go のドキュメントの求め: 自前の User-Agent と安定したセッション ID を付ける。
        "user-agent": "slytxt-writer/1.0",
        "x-opencode-session": "slytxt-writer-summary"
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.3,
        max_tokens: 300,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `タイトル: ${title || "無題"}\n\n本文:\n${truncateText(text, SUMMARY_MAX_BODY_CHARS)}`
          }
        ]
      }),
      signal: controller.signal
    });
    if (!response?.ok) return "";
    const data = await response.json().catch(() => null);
    return cleanSummary(data?.choices?.[0]?.message?.content ?? "");
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}
