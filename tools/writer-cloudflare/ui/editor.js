/*
 * WYSIWYG エディタ（Milkdown Crepe）の入口。
 * prepare-assets が esbuild でバンドルし、public/editor.js と
 * public/editor.css になる。app.js からは window.SlytxtEditor.mount で使う。
 * このファイルが読み込めない・初期化に失敗した場合は、app.js が
 * 従来の textarea にフォールバックする。
 */
import { Crepe } from "@milkdown/crepe";
import { commandsCtx, editorViewCtx } from "@milkdown/kit/core";
import {
  blockquoteSchema,
  bulletListSchema,
  headingSchema,
  listItemSchema,
  orderedListSchema,
  paragraphSchema,
  setBlockTypeCommand,
  wrapInBlockTypeCommand
} from "@milkdown/kit/preset/commonmark";
import { lift } from "@milkdown/kit/prose/commands";
import { liftListItem } from "@milkdown/kit/prose/schema-list";
import { NodeSelection, Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import { $prose, replaceAll } from "@milkdown/kit/utils";
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

/*
 * 選択時ツールバーへ、見出し・引用・リストのブロック操作を足すための道具。
 * Crepe 標準のツールバーは太字などのマーク操作しか無いため、
 * Toolbar 機能の buildToolbar で標準グループの後ろに足す
 * （buildToolbar は標準項目を消さず、グループを追加する形になっている）。
 * アイコンは Crepe 標準アイコンと同じパスデータを使い、見た目をそろえた。
 */
const toolbarIcons = {
  heading2:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3ZM19 19H5V5H19V19ZM15 15H11V13H13C14.1 13 15 12.11 15 11V9C15 7.89 14.1 7 13 7H9V9H13V11H11C9.9 11 9 11.89 9 13V17H15V15Z"/></svg>',
  heading3:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3ZM19 19H5V5H19V19ZM15 15V13.5C15 12.67 14.33 12 13.5 12C14.33 12 15 11.33 15 10.5V9C15 7.89 14.1 7 13 7H9V9H13V11H11V13H13V15H9V17H13C14.1 17 15 16.11 15 15Z"/></svg>',
  text: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M5 5.5C5 6.33 5.67 7 6.5 7H10.5V17.5C10.5 18.33 11.17 19 12 19C12.83 19 13.5 18.33 13.5 17.5V7H17.5C18.33 7 19 6.33 19 5.5C19 4.67 18.33 4 17.5 4H6.5C5.67 4 5 4.67 5 5.5Z"/></svg>',
  quote:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M7.17 17C7.68 17 8.15 16.71 8.37 16.26L9.79 13.42C9.93 13.14 10 12.84 10 12.53V8C10 7.45 9.55 7 9 7H5C4.45 7 4 7.45 4 8V12C4 12.55 4.45 13 5 13H7L5.97 15.06C5.52 15.95 6.17 17 7.17 17ZM17.17 17C17.68 17 18.15 16.71 18.37 16.26L19.79 13.42C19.93 13.14 20 12.84 20 12.53V8C20 7.45 19.55 7 19 7H15C14.45 7 14 7.45 14 8V12C14 12.55 14.45 13 15 13H17L15.97 15.06C15.52 15.95 16.17 17 17.17 17Z"/></svg>',
  bulletList:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M4 10.5C3.17 10.5 2.5 11.17 2.5 12C2.5 12.83 3.17 13.5 4 13.5C4.83 13.5 5.5 12.83 5.5 12C5.5 11.17 4.83 10.5 4 10.5ZM4 4.5C3.17 4.5 2.5 5.17 2.5 6C2.5 6.83 3.17 7.5 4 7.5C4.83 7.5 5.5 6.83 5.5 6C5.5 5.17 4.83 4.5 4 4.5ZM4 16.5C3.17 16.5 2.5 17.18 2.5 18C2.5 18.82 3.18 19.5 4 19.5C4.82 19.5 5.5 18.82 5.5 18C5.5 17.18 4.83 16.5 4 16.5ZM8 19H20C20.55 19 21 18.55 21 18C21 17.45 20.55 17 20 17H8C7.45 17 7 17.45 7 18C7 18.55 7.45 19 8 19ZM8 13H20C20.55 13 21 12.55 21 12C21 11.45 20.55 11 20 11H8C7.45 11 7 11.45 7 12C7 12.55 7.45 13 8 13ZM7 6C7 6.55 7.45 7 8 7H20C20.55 7 21 6.55 21 6C21 5.45 20.55 5 20 5H8C7.45 5 7 5.45 7 6Z"/></svg>',
  orderedList:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M8 7H20C20.55 7 21 6.55 21 6C21 5.45 20.55 5 20 5H8C7.45 5 7 5.45 7 6C7 6.55 7.45 7 8 7ZM20 17H8C7.45 17 7 17.45 7 18C7 18.55 7.45 19 8 19H20C20.55 19 21 18.55 21 18C21 17.45 20.55 17 20 17ZM20 11H8C7.45 11 7 11.45 7 12C7 12.55 7.45 13 8 13H20C20.55 13 21 12.55 21 12C21 11.45 20.55 11 20 11ZM4.5 16H2.5C2.22 16 2 16.22 2 16.5C2 16.78 2.22 17 2.5 17H4V17.5H3.5C3.22 17.5 3 17.72 3 18C3 18.28 3.22 18.5 3.5 18.5H4V19H2.5C2.22 19 2 19.22 2 19.5C2 19.78 2.22 20 2.5 20H4.5C4.78 20 5 19.78 5 19.5V16.5C5 16.22 4.78 16 4.5 16ZM2.5 5H3V7.5C3 7.78 3.22 8 3.5 8C3.78 8 4 7.78 4 7.5V4.5C4 4.22 3.78 4 3.5 4H2.5C2.22 4 2 4.22 2 4.5C2 4.78 2.22 5 2.5 5ZM4.5 10H2.5C2.22 10 2 10.22 2 10.5C2 10.78 2.22 11 2.5 11H3.8L2.12 12.96C2.04 13.05 2 13.17 2 13.28V13.5C2 13.78 2.22 14 2.5 14H4.5C4.78 14 5 13.78 5 13.5C5 13.22 4.78 13 4.5 13H3.2L4.88 11.04C4.96 10.95 5 10.83 5 10.72V10.5C5 10.22 4.78 10 4.5 10Z"/></svg>'
};

/** キャレットのあるテキストブロック自体が指定の種類・属性かどうか。 */
function textblockIs(ctx, type, attrs) {
  const { $from } = ctx.get(editorViewCtx).state.selection;
  const parent = $from.parent;
  if (!parent || parent.type !== type) return false;
  if (!attrs) return true;
  return Object.entries(attrs).every(([key, value]) => parent.attrs[key] === value);
}

/** 選択が指定のノード種の内側にあるかどうか（引用・リストの判定）。 */
function selectionInside(ctx, type) {
  const { $from } = ctx.get(editorViewCtx).state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type === type) return true;
  }
  return false;
}

/** 見出しと段落の切り替え。既にその見出しなら段落に戻す。 */
function toggleHeading(ctx, level) {
  const commands = ctx.get(commandsCtx);
  const heading = headingSchema.type(ctx);
  if (textblockIs(ctx, heading, { level })) {
    commands.call(setBlockTypeCommand.key, { nodeType: paragraphSchema.type(ctx) });
  } else {
    commands.call(setBlockTypeCommand.key, { nodeType: heading, attrs: { level } });
  }
}

function toggleQuote(ctx) {
  const quote = blockquoteSchema.type(ctx);
  if (selectionInside(ctx, quote)) {
    const view = ctx.get(editorViewCtx);
    lift(view.state, view.dispatch, view);
  } else {
    ctx.get(commandsCtx).call(wrapInBlockTypeCommand.key, { nodeType: quote });
  }
}

function toggleList(ctx, listSchema) {
  const listType = listSchema.type(ctx);
  if (selectionInside(ctx, listType)) {
    const view = ctx.get(editorViewCtx);
    liftListItem(listItemSchema.type(ctx))(view.state, view.dispatch, view);
  } else {
    ctx.get(commandsCtx).call(wrapInBlockTypeCommand.key, { nodeType: listType });
  }
}

function buildBlockToolbar(builder) {
  const group = builder.addGroup("blocks", "ブロック");
  group
    .addItem("heading2", {
      label: "大見出し",
      icon: toolbarIcons.heading2,
      active: (ctx) => textblockIs(ctx, headingSchema.type(ctx), { level: 2 }),
      onRun: (ctx) => toggleHeading(ctx, 2)
    })
    .addItem("heading3", {
      label: "小見出し",
      icon: toolbarIcons.heading3,
      active: (ctx) => textblockIs(ctx, headingSchema.type(ctx), { level: 3 }),
      onRun: (ctx) => toggleHeading(ctx, 3)
    })
    .addItem("text", {
      label: "本文",
      icon: toolbarIcons.text,
      active: (ctx) => textblockIs(ctx, paragraphSchema.type(ctx)),
      onRun: (ctx) =>
        ctx
          .get(commandsCtx)
          .call(setBlockTypeCommand.key, { nodeType: paragraphSchema.type(ctx) })
    })
    .addItem("quote", {
      label: "引用",
      icon: toolbarIcons.quote,
      active: (ctx) => selectionInside(ctx, blockquoteSchema.type(ctx)),
      onRun: (ctx) => toggleQuote(ctx)
    })
    .addItem("bulletList", {
      label: "箇条書き",
      icon: toolbarIcons.bulletList,
      active: (ctx) => selectionInside(ctx, bulletListSchema.type(ctx)),
      onRun: (ctx) => toggleList(ctx, bulletListSchema)
    })
    .addItem("orderedList", {
      label: "番号付きリスト",
      icon: toolbarIcons.orderedList,
      active: (ctx) => selectionInside(ctx, orderedListSchema.type(ctx)),
      onRun: (ctx) => toggleList(ctx, orderedListSchema)
    });
}

/*
 * 区切り線（`---` など）の入力変換の直後、キャレットを区切り線の
 * 後ろの段落へ移すためのプラグイン。
 *
 * Crepe 標準の insertHrInputRule は、変換後に hr ノード自身が選択された
 * 状態（NodeSelection）で終わる。そのまま打ち続けると入力した文字が
 * 区切り線を置き換えて消してしまい、Enter を押すと線の上に段落ができて
 * しまう（note では線の下で書き続けられる）。文書を変えた transaction の
 * 結果として hr が選択されていた場合だけ、後続の段落へキャレットを移す。
 * 既存の hr をクリックで選んだだけの選択変更では発火しない。
 */
const hrCaretPlugin = $prose(
  () =>
    new Plugin({
      key: new PluginKey("slytxt-hr-caret"),
      appendTransaction(transactions, _oldState, newState) {
        if (!transactions.some((tr) => tr.docChanged)) return null;
        const { selection, doc } = newState;
        if (!(selection instanceof NodeSelection)) return null;
        if (selection.node.type.name !== "hr") return null;

        const after = selection.from + selection.node.nodeSize;
        const tr = newState.tr;
        const next = after < doc.content.size ? doc.nodeAt(after) : null;
        if (next?.isTextblock) {
          return tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1), 1));
        }
        // 後ろに段落が無い（またはテキストブロックでない）場合は段落を足して入る。
        const paragraph = doc.type.schema.nodes.paragraph;
        if (!paragraph) return null;
        tr.insert(after, paragraph.create());
        return tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1), 1));
      }
    })
);

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
      [Crepe.Feature.Toolbar]: {
        buildToolbar: buildBlockToolbar
      },
      [Crepe.Feature.ImageBlock]: {
        onUpload: upload,
        inlineOnUpload: upload,
        blockOnUpload: upload
      }
    }
  });
  crepe.editor.use(hrCaretPlugin);
  if (onChange) {
    crepe.on((listener) => {
      listener.markdownUpdated((ctx, markdown, previous) => {
        if (markdown !== previous) onChange(markdown);
      });
    });
  }
  await crepe.create();
  // WYSIWYG の編集領域（contenteditable）にも textarea と同じ名前を伝える。
  const editable = root.querySelector("[contenteditable]");
  if (editable) {
    editable.setAttribute("aria-label", root.getAttribute("aria-label") ?? "本文");
  }
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
