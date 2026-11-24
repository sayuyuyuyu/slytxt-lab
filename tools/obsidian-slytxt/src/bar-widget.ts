/**
 * ノート画面の最上部に出す公開バー（設計案B、#849）。
 *
 * エディタ（CodeMirror 6）の先頭にブロックウィジェットとして差し込む。
 * 画面遷移もモーダルもコマンドも使わず、ノートを開いた時点で値が入った
 * バーが見えている状態にする。値の正は frontmatter のままで、バーの操作は
 * controller 経由で frontmatter を書き換える。
 *
 * @codemirror/* は esbuild で external にしている（Obsidian 本体が持つ
 * ものを使う。プラグインに同梱すると状態が混ざる）。
 */
import { StateField } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet
} from "@codemirror/view";
import { nextCategory, type BarState } from "./lib/bar.ts";
import type { PublishCategory } from "./lib/slug.ts";

export type BarSnapshot = BarState & {
  publishing: boolean;
};

export type BarController = {
  /** バーに出す値。対象外（Markdown 以外・読み込み前）は null。 */
  snapshot(): BarSnapshot | null;
  setCategory(category: PublishCategory): void;
  addTag(input: string): void;
  removeTag(tag: string): void;
  pickCover(): void;
  publish(): void;
  subscribe(listener: () => void): () => void;
};

/** チップに出す区分の表示名。サイトのナビと同じ言葉にする。 */
const CATEGORY_LABELS: Record<PublishCategory, string> = {
  tech: "Tech",
  misc: "なんか",
  comic: "Comic",
  game: "Game",
  anime: "Anime"
};

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

class PublishBarWidget extends WidgetType {
  private root: HTMLElement | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(readonly controller: BarController) {
    super();
  }

  /** 同じ controller なら DOM を使い回す（入力中に作り直さない）。 */
  eq(other: PublishBarWidget): boolean {
    return other.controller === this.controller;
  }

  ignoreEvent(): boolean {
    // バーの中のクリック・入力はエディタに渡さない。
    return true;
  }

  toDOM(): HTMLElement {
    const root = element("div", "slytxt-bar");
    root.setAttribute("contenteditable", "false");
    this.root = root;
    this.unsubscribe = this.controller.subscribe(() => this.render());
    this.render();
    return root;
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.root = null;
  }

  private render(): void {
    const root = this.root;
    if (!root) return;
    const state = this.controller.snapshot();
    root.replaceChildren();
    root.hidden = state === null;
    if (!state) return;

    // カテゴリ: 押すたびに次の区分へ。
    const category = element("button", "slytxt-bar__chip slytxt-bar__category");
    category.type = "button";
    category.textContent = CATEGORY_LABELS[state.category];
    category.title = "押すと区分を切り替える";
    category.addEventListener("click", (event) => {
      event.preventDefault();
      this.controller.setCategory(nextCategory(state.category));
    });
    root.append(category);

    // タグ: チップと入力欄。
    const tags = element("div", "slytxt-bar__tags");
    for (const tag of state.tags) {
      const chip = element("span", "slytxt-bar__chip slytxt-bar__tag");
      chip.append(document.createTextNode(`#${tag}`));
      const remove = element("button", "slytxt-bar__remove");
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `${tag} を外す`);
      remove.addEventListener("click", (event) => {
        event.preventDefault();
        this.controller.removeTag(tag);
      });
      chip.append(remove);
      tags.append(chip);
    }
    const input = element("input", "slytxt-bar__tag-input");
    input.type = "text";
    input.placeholder = "タグを追加";
    input.setAttribute("aria-label", "タグを追加");
    input.addEventListener("keydown", (event) => {
      // エディタのショートカット（改行・補完）に取られないようにする。
      event.stopPropagation();
      if (event.key === "Enter" || event.key === ",") {
        event.preventDefault();
        this.controller.addTag(input.value);
      }
    });
    input.addEventListener("keyup", (event) => event.stopPropagation());
    input.addEventListener("blur", () => {
      if (input.value.trim()) this.controller.addTag(input.value);
    });
    tags.append(input);
    root.append(tags);

    // カバー: サムネイル（無ければ「カバー」）。押すと画像を選ぶ。
    const cover = element("button", "slytxt-bar__cover");
    cover.type = "button";
    cover.title = state.cover ? "カバーを変更" : "カバーを選ぶ";
    if (state.cover) {
      const img = element("img", "slytxt-bar__cover-image");
      img.src = state.cover;
      img.alt = "";
      cover.append(img);
    } else {
      cover.textContent = "カバー";
    }
    cover.addEventListener("click", (event) => {
      event.preventDefault();
      this.controller.pickCover();
    });
    root.append(cover);

    // 公開。
    const publish = element("button", "slytxt-bar__publish");
    publish.type = "button";
    publish.textContent = state.publishing ? "公開中…" : "公開";
    publish.disabled = state.publishing;
    publish.addEventListener("click", (event) => {
      event.preventDefault();
      this.controller.publish();
    });
    root.append(publish);
  }

}

function buildDecorations(controller: BarController): DecorationSet {
  const bar = Decoration.widget({
    widget: new PublishBarWidget(controller),
    side: -1,
    block: true
  });
  return Decoration.set([bar.range(0)], true);
}

/**
 * エディタの先頭に公開バーを出す拡張。
 *
 * ブロックウィジェットは StateField からしか出せない（ViewPlugin から出すと
 * Obsidian がノートを開くときに例外になり、ファイルが開けなくなる）。
 */
export function publishBarExtension(controller: BarController) {
  const field = StateField.define<DecorationSet>({
    create: () => buildDecorations(controller),
    update: (decorations, tr) =>
      // widget の eq() が同じ controller を返すので、DOM は作り直されない。
      tr.docChanged ? buildDecorations(controller) : decorations,
    provide: (value) => EditorView.decorations.from(value)
  });
  return field;
}
