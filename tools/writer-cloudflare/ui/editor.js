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
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
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

/*
 * 埋め込みのプレビュー。
 *
 * 公開側（src/lib/remark-embed.mjs）は「URL だけの段落」を埋め込みに
 * 変える。編集画面でも公開時の見え方が分かるよう、同じ条件の段落の
 * 直下にカード風のプレビューを decoration で出す。あくまで表示だけで、
 * markdown は URL のまま変わらない（判定ルールは公開側と揃える）。
 * 一般 URL の OGP はブラウザから取得できない（CORS）ため、編集側では
 * ホスト名だけのカードにする。OGP の取得は公開側のビルド時に行う。
 */
function classifyUrlForPreview(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^(www\.|m\.)/, "");
  if (host === "youtu.be") {
    const id = parsed.pathname.slice(1).split("/")[0];
    return /^[A-Za-z0-9_-]{6,}$/.test(id) ? { type: "youtube", id, url } : { type: "link", url };
  }
  if (host === "youtube.com") {
    let id = null;
    if (parsed.pathname === "/watch") id = parsed.searchParams.get("v");
    else id = parsed.pathname.match(/^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{6,})/)?.[1] ?? null;
    return id && /^[A-Za-z0-9_-]{6,}$/.test(id)
      ? { type: "youtube", id, url }
      : { type: "link", url };
  }
  const bareHost = parsed.hostname.replace(/^www\./, "");
  if (bareHost === "x.com" || bareHost === "twitter.com") {
    const match = parsed.pathname.match(/^\/([A-Za-z0-9_]+)\/status\/(\d+)/);
    if (match) return { type: "x", user: match[1], id: match[2], url };
  }
  return { type: "link", url };
}

/** 段落の中身がテキストの URL 1つだけなら、その URL を返す。 */
function loneUrlText(node) {
  let text = "";
  let onlyText = true;
  node.forEach((child) => {
    if (child.isText) text += child.text;
    else onlyText = false;
  });
  if (!onlyText) return null;
  const url = text.trim();
  return /^https?:\/\/\S+$/.test(url) ? url : null;
}

function embedPreviewDom(embed) {
  const root = document.createElement("div");
  root.className = `embed-preview embed-preview--${embed.type}`;
  root.setAttribute("contenteditable", "false");
  if (embed.type === "youtube") {
    const thumb = document.createElement("img");
    thumb.className = "embed-preview__thumb";
    thumb.src = `https://i.ytimg.com/vi/${embed.id}/hqdefault.jpg`;
    thumb.alt = "";
    thumb.loading = "lazy";
    root.append(thumb);
  }
  const meta = document.createElement("div");
  meta.className = "embed-preview__meta";
  const kind = document.createElement("span");
  kind.className = "embed-preview__kind";
  kind.textContent =
    embed.type === "youtube"
      ? "YouTube 埋め込み"
      : embed.type === "x"
        ? "X のポスト"
        : "リンクカード";
  const url = document.createElement("span");
  url.className = "embed-preview__url";
  url.textContent = embed.url;
  meta.append(kind, url);
  root.append(meta);
  return root;
}

const embedPreviewPlugin = $prose(
  () =>
    new Plugin({
      key: new PluginKey("slytxt-embed-preview"),
      props: {
        decorations(state) {
          const items = [];
          state.doc.forEach((node, offset) => {
            if (node.type.name !== "paragraph") return;
            const url = loneUrlText(node);
            if (!url) return;
            const embed = classifyUrlForPreview(url);
            if (!embed) return;
            items.push(
              Decoration.widget(offset + node.nodeSize, () => embedPreviewDom(embed), {
                side: 1,
                ignoreSelection: true,
                key: `embed:${url}`
              })
            );
          });
          return items.length ? DecorationSet.create(state.doc, items) : DecorationSet.empty;
        }
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
export async function createCrepe(
  root,
  { value = "", onChange, onUpload, onUploadState, features } = {}
) {
  const upload =
    onUpload ??
    (async () => {
      throw new Error("画像のアップロード先が設定されていません。");
    });

  /*
   * 画像アップロードの非同期化。
   *
   * Crepe 標準では、アップロード（この writer では GitHub PR → CI →
   * マージまで待つ処理）が終わるまで画像が本文に入らない。代わりに
   * blob URL を即座に返してローカルプレビューを出し、本来の
   * アップロードは裏で進める。完了したら文書内の画像ノードの src を
   * 最終 URL へ差し替える。状態は onUploadState で app.js へ通知し、
   * エディタバーの表示と保存時の URL 解決（handle 参照）に使う。
   */
  const uploads = new Map();
  let donePulse = 0;
  const notifyUploads = () => {
    if (!onUploadState) return;
    let active = 0;
    const failures = [];
    for (const record of uploads.values()) {
      if (record.state === "posting" || record.state === "reflecting") active += 1;
      if (record.state === "failed") failures.push(record.error);
    }
    onUploadState({ active, failures, donePulse });
  };
  const swapImageSrc = (blobUrl, finalUrl) => {
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const positions = [];
      view.state.doc.descendants((node, pos) => {
        if (
          (node.type.name === "image-block" || node.type.name === "image") &&
          node.attrs.src === blobUrl
        ) {
          positions.push(pos);
        }
      });
      if (!positions.length) return;
      let tr = view.state.tr;
      for (const pos of positions) {
        const node = tr.doc.nodeAt(pos);
        if (node) tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: finalUrl });
      }
      view.dispatch(tr);
    });
  };
  const startUpload = (record) => {
    record.state = "posting";
    record.error = "";
    notifyUploads();
    (async () => {
      try {
        const finalUrl = await upload(record.file, {
          onPosted: (url) => {
            // POST が通った時点で最終 URL は確定する。ここからは
            // PR の反映待ち（保存はこの URL で行ってよい）。
            if (url) record.finalUrl = url;
            record.state = "reflecting";
            record.resolvePosted(url ?? "");
            notifyUploads();
          }
        });
        record.finalUrl = finalUrl;
        record.state = "done";
        record.resolvePosted(finalUrl);
        swapImageSrc(record.blobUrl, finalUrl);
        URL.revokeObjectURL(record.blobUrl);
        donePulse += 1;
        notifyUploads();
      } catch (error) {
        record.state = "failed";
        record.error = error?.message ?? String(error);
        record.resolvePosted("");
        notifyUploads();
      }
    })();
  };
  const uploadForCrepe = async (file) => {
    const blobUrl = URL.createObjectURL(file);
    let resolvePosted;
    const posted = new Promise((resolve) => {
      resolvePosted = resolve;
    });
    const record = {
      blobUrl,
      file,
      state: "posting",
      finalUrl: "",
      error: "",
      posted,
      resolvePosted
    };
    uploads.set(blobUrl, record);
    startUpload(record);
    return blobUrl;
  };
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
        onUpload: uploadForCrepe,
        inlineOnUpload: uploadForCrepe,
        blockOnUpload: uploadForCrepe
      }
    }
  });
  crepe.editor.use(hrCaretPlugin);
  crepe.editor.use(embedPreviewPlugin);
  if (onChange) {
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown, previous) => {
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
    destroy: () => {
      for (const record of uploads.values()) URL.revokeObjectURL(record.blobUrl);
      return crepe.destroy();
    },
    // 画像の POST（最終 URL の確定）までを待つ。保存前に呼ぶことで、
    // URL 未確定の画像が下書きから落ちるのを防ぐ。PR のマージ完了は待たない。
    whenPosted: () =>
      Promise.all(
        [...uploads.values()]
          .filter((record) => record.state === "posting")
          .map((record) => record.posted)
      ),
    // 失敗した画像のアップロードをやり直す（エディタバーの再試行ボタン用）。
    retryFailedUploads: () => {
      for (const record of uploads.values()) {
        if (record.state === "failed") startUpload(record);
      }
    },
    /*
     * 保存用 markdown の中の blob URL を、確定した最終 URL へ置き換える。
     * 未確定・失敗のものは空文字にする（blob URL を下書きに残さないため。
     * 未確定の画像は完了時の差し替えで保存し直される）。
     */
    resolveImageUrls: (markdown) => {
      let text = String(markdown);
      for (const record of uploads.values()) {
        if (!text.includes(record.blobUrl)) continue;
        if (record.finalUrl) {
          text = text.split(record.blobUrl).join(record.finalUrl);
        } else {
          // URL が未確定・失敗の間は、画像記法ごと下書きから落とす
          // （空の URL の画像を残さないため。完了すれば差し替え時に保存し直される）。
          const escaped = record.blobUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          text = text.replace(
            new RegExp(`!\\[[^\\]]*\\]\\(\\s*${escaped}(?:\\s+["'][^"']*["'])?\\s*\\)`, "g"),
            ""
          );
        }
      }
      return text;
    },
    // 検証スクリプト（scripts/check-editor.mjs）から編集を再現するための生インスタンス。
    crepe
  };
}

/*
 * 画像の alt とキャプションの受け渡し。
 *
 * 保存形式は ![alt](url "caption") とし、alt（代替テキスト）と
 * キャプション（読者向けの説明文）を分けて持つ。公開側は title を
 * キャプションとして画像下に表示する（src/lib/rehype-figure.mjs）。
 *
 * Crepe のブロック画像は、markdown の alt 欄を「表示比率」の保存に使う
 * （serialize すると alt が "1.00" のような数値になる）。そのままでは
 * 本来の alt が編集のたびに消えてしまうため、受け渡しはこうする:
 * - エディタへ渡すとき: キャプションは title 欄（Crepe のキャプション欄）
 *   にそのまま置き、本来の alt は URL をキーにこのモジュールへ退避する。
 * - エディタから戻るとき: 退避した alt を URL で引き戻して
 *   ![alt](url "caption") に組み直す。比率はサイト側の表示に影響しない
 *   ので捨てる。
 * 対象は行単独の画像（ブロック画像）だけで、コードブロック内は触らない。
 *
 * 旧形式 ![キャプション](url)（alt 欄にキャプションが入っている既存の
 * 下書き）は、読み込み時にキャプションを title 欄へ移す。次に保存すると
 * 新形式にそろう。
 */
const IMAGE_LINE = /^!\[([^\]]*)\]\(\s*(\S+?)(?:\s+["']([^"']*)["'])?\s*\)$/;
const RATIO_LIKE = /^\d+(\.\d+)?$/;

/** エディタ表示中だけ保持する、本来の alt（URL → alt）。 */
const imageAltByUrl = new Map();

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

/** textarea の markdown → エディタ用（alt を退避し、キャプションを title 欄へ）。 */
export function imagesToEditor(markdown) {
  return mapImageLines(markdown, ({ alt, url, title }) => {
    if (title) {
      // 新形式: キャプションは title のまま、alt だけ退避する。
      if (alt && !RATIO_LIKE.test(alt) && !alt.includes('"')) {
        imageAltByUrl.set(url, alt);
        return `![](${url} "${title}")`;
      }
      return null;
    }
    if (!alt || RATIO_LIKE.test(alt) || alt.includes('"')) return null;
    // 旧形式: alt 欄のキャプションを title 欄へ移す（alt は空として記録）。
    imageAltByUrl.set(url, "");
    return `![](${url} "${alt}")`;
  });
}

/** エディタの markdown → 保存用（退避した alt を戻し、キャプションは title へ）。 */
export function imagesFromEditor(markdown) {
  return mapImageLines(markdown, ({ alt, url, title }) => {
    if (!RATIO_LIKE.test(alt)) return null;
    const realAlt = imageAltByUrl.get(url) ?? "";
    const head = realAlt ? `![${realAlt}](${url}` : `![](${url}`;
    if (!title) return `${head})`;
    if (!title.includes('"')) return `${head} "${title}")`;
    if (!title.includes("'")) return `${head} '${title}')`;
    // 引用符を両方含むキャプションは title に載せられないため、旧形式に落とす。
    return `![${title}](${url})`;
  });
}

window.SlytxtEditor = {
  mount: (root, options) => createCrepe(root, options),
  imagesToEditor,
  imagesFromEditor
};
