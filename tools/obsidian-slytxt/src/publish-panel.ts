/**
 * 公開直前の入力パネル（#905）。
 *
 * ノート画面には何も出さない。公開したいときだけこのパネルを開き、実値が
 * 入った状態から本人が確認して押す。値の事前入力は panelValues が行う。
 * タグはカンマ区切りにせずチップで扱い、カテゴリは選択制にする。
 */
import { App, Modal, setIcon } from "obsidian";
import type { PanelValues } from "./lib/note-properties";
import { PUBLISH_CATEGORIES, type PublishCategory } from "./lib/slug";

export type PublishPanelOptions = {
  /** 画像を選んでアップロードし、公開 URL を返す。 */
  uploadCover: () => Promise<string>;
  /** 入力が確定したときに呼ぶ。 */
  submit: (values: PanelValues) => void;
};

export class PublishPanel extends Modal {
  private values: PanelValues;
  private tagInputEl!: HTMLInputElement;
  private tagsEl!: HTMLElement;
  private coverEl!: HTMLImageElement;
  private coverEmptyEl!: HTMLElement;

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

    // カバー: サムネイルと、押すと端末から選べるボタン。
    const coverWrap = row.createDiv({ cls: "slytxt-panel__cover" });
    this.coverEl = coverWrap.createEl("img", { cls: "slytxt-panel__thumb" });
    this.coverEmptyEl = coverWrap.createDiv({ cls: "slytxt-panel__thumb slytxt-panel__thumb--empty" });
    const pick = coverWrap.createEl("button", { cls: "clickable-icon" });
    pick.type = "button";
    pick.setAttr("aria-label", "cover");
    setIcon(pick, "image");
    pick.addEventListener("click", async () => {
      pick.disabled = true;
      try {
        const url = await this.options.uploadCover();
        if (url) {
          this.values.cover = url;
          this.renderCover();
        }
      } finally {
        pick.disabled = false;
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
    const has = Boolean(this.values.cover);
    this.coverEl.toggleAttribute("hidden", !has);
    this.coverEmptyEl.toggleAttribute("hidden", has);
    if (has) this.coverEl.src = this.values.cover;
  }
}
