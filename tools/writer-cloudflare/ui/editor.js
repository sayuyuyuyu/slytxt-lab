/*
 * WYSIWYG エディタ（Milkdown Crepe）の入口。
 * prepare-assets が esbuild でバンドルし、public/editor.js と
 * public/editor.css になる。app.js からは window.SlytxtEditor.mount で使う。
 * このファイルが読み込めない・初期化に失敗した場合は、app.js が
 * 従来の textarea にフォールバックする。
 */
import { Crepe } from "@milkdown/crepe";
import { replaceAll } from "@milkdown/kit/utils";
// common/style.css は latex.css（KaTeX フォント一式）まで含むため、
// 使う feature の分だけ個別に読む（Latex / AI / TopBar は無効化している）。
import "@milkdown/crepe/theme/common/prosemirror.css";
import "@milkdown/crepe/theme/common/reset.css";
import "@milkdown/crepe/theme/common/block-edit.css";
import "@milkdown/crepe/theme/common/code-mirror.css";
import "@milkdown/crepe/theme/common/cursor.css";
import "@milkdown/crepe/theme/common/image-block.css";
import "@milkdown/crepe/theme/common/link-tooltip.css";
import "@milkdown/crepe/theme/common/list-item.css";
import "@milkdown/crepe/theme/common/placeholder.css";
import "@milkdown/crepe/theme/common/toolbar.css";
import "@milkdown/crepe/theme/common/table.css";
import "@milkdown/crepe/theme/frame.css";
import "./editor.css";

/**
 * エディタを作る。戻り値の handle:
 * - getMarkdown(): 現在の本文を markdown で返す
 * - setMarkdown(markdown): 本文を丸ごと差し替える（下書きの切り替え用）
 * - destroy(): 破棄する
 * onChange はユーザー編集で markdown が変わるたびに呼ばれる。
 * onUpload は画像ファイルを受け取り、公開 URL を返す関数（app.js 側）。
 */
export async function createCrepe(root, { value = "", onChange, onUpload, features } = {}) {
  const upload =
    onUpload ??
    (async () => {
      throw new Error("画像のアップロード先が設定されていません。");
    });
  const crepe = new Crepe({
    root,
    defaultValue: value,
    features: {
      // 数式と AI・上部バーはこの執筆ツールでは使わない。
      [Crepe.Feature.Latex]: false,
      [Crepe.Feature.AI]: false,
      [Crepe.Feature.TopBar]: false,
      ...features
    },
    featureConfigs: {
      [Crepe.Feature.Placeholder]: { text: "書き始める…", mode: "doc" },
      [Crepe.Feature.ImageBlock]: {
        onUpload: upload,
        inlineOnUpload: upload,
        blockOnUpload: upload
      }
    }
  });
  if (onChange) {
    crepe.on((listener) => {
      listener.markdownUpdated((ctx, markdown, previous) => {
        if (markdown !== previous) onChange(markdown);
      });
    });
  }
  await crepe.create();
  return {
    getMarkdown: () => crepe.getMarkdown(),
    setMarkdown: (markdown) => crepe.editor.action(replaceAll(markdown)),
    destroy: () => crepe.destroy(),
    // 検証スクリプト（scripts/check-editor.mjs）から編集を再現するための生インスタンス。
    crepe
  };
}

/*
 * 画像の alt の受け渡し。
 *
 * Crepe のブロック画像は、markdown の alt 欄を「表示比率」の保存に使う
 * （serialize すると alt が "1.00" のような数値になる）。そのままでは
 * 既存の下書きの alt テキストが編集のたびに消えてしまうため、
 * エディタへ渡すときに alt をキャプション（title 欄）へ移し、
 * エディタから戻るときにキャプションを alt へ戻す。比率はサイト側の
 * 表示に影響しない（通常の img として描画される）ので捨てる。
 * 対象は行単独の画像（ブロック画像）だけで、コードブロック内は触らない。
 */
const IMAGE_LINE = /^!\[([^\]]*)\]\(\s*(\S+?)(?:\s+["']([^"']*)["'])?\s*\)$/;
const RATIO_LIKE = /^\d+(\.\d+)?$/;

function mapImageLines(markdown, convert) {
  let inFence = false;
  return String(markdown)
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      const match = line.trim().match(IMAGE_LINE);
      if (!match) return line;
      return convert({ alt: match[1], url: match[2], title: match[3] }) ?? line;
    })
    .join("\n");
}

/** textarea の markdown → エディタ用（alt をキャプションへ移す）。 */
export function imagesToEditor(markdown) {
  return mapImageLines(markdown, ({ alt, url, title }) => {
    if (!alt || RATIO_LIKE.test(alt) || title || alt.includes('"')) return null;
    return `![](${url} "${alt}")`;
  });
}

/** エディタの markdown → 保存用（キャプションを alt へ戻し、比率は捨てる）。 */
export function imagesFromEditor(markdown) {
  return mapImageLines(markdown, ({ alt, url, title }) => {
    if (!RATIO_LIKE.test(alt)) return null;
    return title ? `![${title}](${url})` : `![](${url})`;
  });
}

window.SlytxtEditor = {
  mount: (root, options) => createCrepe(root, options),
  imagesToEditor,
  imagesFromEditor
};
