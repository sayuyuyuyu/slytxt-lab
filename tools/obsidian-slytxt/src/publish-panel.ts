/**
 * 公開直前の入力パネル（#905）。
 *
 * ノート画面には何も出さない。公開したいときだけこのパネルを開き、実値が
 * 入った状態から本人が確認して押す。値の事前入力は panelValues が行う。
 * タグはカンマ区切りにせずチップで扱い、カテゴリは選択制にする。
 * サムネイルはラベルと文字付きの操作で示す（#917）。アイコンだけにしない。
 */
import { App, Modal } from "obsidian";
import type { PanelValues } from "./lib/note-properties";
import { PUBLISH_CATEGORIES, type PublishCategory } from "./lib/slug";

export type PublishPanelOptions = {
  /** 本文に出てくる画像の参照（出現順、重複なし）。 */
  bodyImages: string[];
  /** 参照を、パネルの中で表示できる URL にする（Vault 内ならローカルの URL）。 */
  previewCover: (source: string) => string;
  /** 端末から画像を選んでアップロードし、公開 URL を返す。失敗したら空文字。 */
  uploadCover: () => Promise<string>;
  /** 入力が確定したときに呼ぶ。 */
  submit: (values: PanelValues) => void;
};

/** 画像の参照から、選択肢に出す名前を探す。 */
function coverName(source: string): string {
  const name = source.split(/[\\/]/).pop() ?? source;
  return name || source;
}

export class PublishPanel extends Modal {
  private values: PanelValues;
  private tagInputEl!: HTMLInputElement;
  private tagsEl!: HTMLElement;
  private coverEl!: HTMLImageElement;
  private coverEmptyEl!: HTMLElement;
  private coverStateEl!: HTMLElement;
  private coverSelectEl!: HTMLSelectElement;
  private coverUploadEl!: HTMLButtonElement;

  constructor(
    app: App,
    initial: PanelValues,
    private readonly options: PublishPanelOptions
  ) {
    super(app);
    this.values = { ...initial, tags: [...initial.tags] };
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("slytxt-panel");
    contentEl.empty();

    const title = contentEl.createEl("input", { type: "text", cls: "slytxt-panel__title" });
    title.value = this.values.title;
    title.addEventListener("input", () => (this.values.title = title.value));

    const description = contentEl.createEl("textarea", { cls: "slytxt-panel__description" });
    description.value = this.values.description;
    description.rows = 3;
    description.addEventListener("input", () => (this.values.description = description.value));

    const row = contentEl.createDiv({ cls: "slytxt-panel__row" });

    // カテゴリは選択制（自由入力にしない）。
    const category = row.createEl("select", { cls: "dropdown" });
    for (const value of PUBLISH_CATEGORIES) {
      const option = category.createEl("option", { text: value });
      option.value = value;
      if (value === this.values.category) option.selected = true;
    }
    category.addEventListener("change", () => {
      this.values.category = category.value as PublishCategory;
    });

    // カバー: 見出しと、選べることが分かる操作を置く（#917）。
    const coverWrap = contentEl.createDiv({ cls: "slytxt-panel__cover" });
    const coverHead = coverWrap.createDiv({ cls: "slytxt-panel__cover-head" });
    coverHead.createSpan({ cls: "slytxt-panel__label", text: "サムネイル" });
    this.coverStateEl = coverHead.createSpan({ cls: "slytxt-panel__cover-state" });
    this.coverEl = coverWrap.createEl("img", { cls: "slytxt-panel__thumb" });
    this.coverEmptyEl = coverWrap.createDiv({ cls: "slytxt-panel__thumb slytxt-panel__thumb--empty" });
    const coverControls = coverWrap.createDiv({ cls: "slytxt-panel__cover-controls" });
    this.coverSelectEl = coverControls.createEl("select", {
      cls: "dropdown",
      attr: { "aria-label": "サムネイル" }
    });
    this.coverSelectEl.addEventListener("change", () => this.applyCoverChoice(this.coverSelectEl.value));
    this.coverUploadEl = coverControls.createEl("button", { text: "画像をアップロード" });
    this.coverUploadEl.type = "button";
    this.coverUploadEl.addEventListener("click", async () => {
      this.coverUploadEl.disabled = true;
      try {
        const url = await this.options.uploadCover();
        if (url) {
          this.values.cover = url;
          this.values.coverMode = "set";
          this.renderCover();
        }
      } finally {
        this.coverUploadEl.disabled = false;
      }
    });

    // タグ: チップ + 入力（Enter で追加）。
    this.tagsEl = contentEl.createDiv({ cls: "slytxt-panel__tags" });
    this.tagInputEl = contentEl.createEl("input", {
      type: "text",
      cls: "slytxt-panel__tag-input"
    });
    this.tagInputEl.setAttr("aria-label", "tags");
    this.tagInputEl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      this.addTag(this.tagInputEl.value);
      this.tagInputEl.value = "";
    });

    const actions = contentEl.createDiv({ cls: "modal-button-container" });
    const publish = actions.createEl("button", { text: "公開", cls: "mod-cta" });
    publish.type = "button";
    publish.addEventListener("click", () => {
      this.options.submit({ ...this.values, tags: [...this.values.tags] });
      this.close();
    });
    const cancel = actions.createEl("button", { text: "キャンセル" });
    cancel.type = "button";
    cancel.addEventListener("click", () => this.close());

    this.renderCover();
    this.renderTags();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private addTag(raw: string): void {
    const tag = raw.trim().replace(/^#/, "");
    if (!tag || this.values.tags.includes(tag) || this.values.tags.length >= 10) return;
    this.values.tags.push(tag);
    this.renderTags();
  }

  private renderTags(): void {
    this.tagsEl.empty();
    for (const tag of this.values.tags) {
      const chip = this.tagsEl.createSpan({ cls: "slytxt-panel__tag", text: `#${tag}` });
      const remove = chip.createSpan({ cls: "slytxt-panel__tag-remove", text: "×" });
      remove.addEventListener("click", () => {
        this.values.tags = this.values.tags.filter((item) => item !== tag);
        this.renderTags();
      });
    }
  }

  private renderCover(): void {
    const source = this.coverSource();
    const preview = source
      ? /^https?:\/\//.test(source)
        ? source
        : this.options.previewCover(source)
      : "";
    this.coverEl.toggleAttribute("hidden", !preview);
    this.coverEmptyEl.toggleAttribute("hidden", Boolean(preview));
    if (preview) this.coverEl.src = preview;
    this.coverStateEl.setText(this.coverStateText(source));
    this.renderCoverSelect();
  }

  /** いま選んでいる画像の参照。無ければ空文字。 */
  private coverSource(): string {
    if (this.values.coverMode === "set") return this.values.cover;
    if (this.values.coverMode === "auto") return this.options.bodyImages[0] ?? "";
    return "";
  }

  private coverStateText(source: string): string {
    if (this.values.coverMode === "none") return "なし（サムネイルを付けない）";
    if (this.values.coverMode === "auto") return "本文の先頭の画像";
    return source ? coverName(source) : "なし（サムネイルを付けない）";
  }

  /** 選択肢は「本文の先頭の画像」「なし」「本文の画像」の順に並べ直す。 */
  private renderCoverSelect(): void {
    const select = this.coverSelectEl;
    select.empty();
    const add = (value: string, text: string): HTMLOptionElement => {
      const option = select.createEl("option", { text });
      option.value = value;
      return option;
    };
    add("auto", "本文の先頭の画像");
    add("none", "なし");
    this.options.bodyImages.forEach((source, index) => {
      add(`body:${index}`, `${index + 1}. ${coverName(source)}`);
    });
    const uploaded = this.values.coverMode === "set" && !this.options.bodyImages.includes(this.values.cover);
    if (uploaded) add("uploaded", "アップロードした画像");
    select.value = this.coverChoiceValue(uploaded);
  }

  private coverChoiceValue(uploaded: boolean): string {
    if (this.values.coverMode === "auto") return "auto";
    if (this.values.coverMode === "none") return "none";
    if (uploaded) return "uploaded";
    const index = this.options.bodyImages.indexOf(this.values.cover);
    return index === -1 ? "auto" : `body:${index}`;
  }

  /** 選択肢の値から、カバーの決め方を入れ替える。 */
  private applyCoverChoice(value: string): void {
    if (value === "auto") {
      this.values.coverMode = "auto";
      this.values.cover = "";
    } else if (value === "none") {
      this.values.coverMode = "none";
      this.values.cover = "";
    } else if (value.startsWith("body:")) {
      const source = this.options.bodyImages[Number(value.slice("body:".length))];
      if (!source) return;
      this.values.coverMode = "set";
      this.values.cover = source;
    } else {
      return;
    }
    this.renderCover();
  }
}
