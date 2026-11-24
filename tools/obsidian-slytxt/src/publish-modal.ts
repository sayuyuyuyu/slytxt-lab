import {
  App,
  Modal,
  Notice,
  Setting,
  type TextAreaComponent,
  type TextComponent
} from "obsidian";
import { deriveDescription } from "./lib/publish-plan";
import { PUBLISH_CATEGORIES, isPublishCategory, type PublishCategory } from "./lib/slug";

export type PublishScreenValues = {
  category: PublishCategory;
  title: string;
  tags: string[];
  description: string;
  cover: string;
};

export type PublishScreenOptions = {
  /** 説明文の候補を作る材料（ノート本文）。 */
  bodyText: string;
  /** カバー未指定のときに自動で使われるカバー（本文の最初の画像が URL の場合）。 */
  autoCoverUrl?: string;
  /** 画像を選んでアップロードし、公開 URL を返す。 */
  onUploadCover: () => Promise<string>;
  /** 公開を実行する。失敗したら throw する（画面は開いたままにする）。 */
  onPublish: (values: PublishScreenValues) => Promise<void>;
};

/**
 * 公開に必要な編集をすべて1画面に集めたモーダル。
 * タイトル・カテゴリ・タグ・説明・カバーの編集と公開ボタンをここに置き、
 * プロパティ欄やコマンドを行き来しなくて済むようにする。
 * 初期値は呼び出し側で本文から補って渡す（タイトル＝最初の見出し、
 * カバー＝本文の最初の画像、説明＝書き出し）。
 */
export class PublishModal extends Modal {
  private values: PublishScreenValues;
  private readonly onPublish: (values: PublishScreenValues) => Promise<void>;
  private readonly options: PublishScreenOptions;
  private descriptionInput: TextAreaComponent | null = null;
  private coverInput: TextComponent | null = null;
  private coverPreview: HTMLImageElement | null = null;
  private tagsEl: HTMLElement | null = null;
  private publishing = false;

  constructor(
    app: App,
    initial: PublishScreenValues,
    options: PublishScreenOptions
  ) {
    super(app);
    this.values = { ...initial, tags: [...initial.tags] };
    this.onPublish = options.onPublish;
    this.options = options;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("slytxt-publish-modal");
    contentEl.createEl("h2", { text: "公開" });

    new Setting(contentEl).setName("カテゴリ").addDropdown((dropdown) => {
      for (const category of PUBLISH_CATEGORIES) {
        dropdown.addOption(category, category);
      }
      dropdown.setValue(this.values.category).onChange((value) => {
        if (isPublishCategory(value)) this.values.category = value;
      });
    });

    new Setting(contentEl)
      .setName("タイトル")
      .setDesc("空なら本文の最初の見出しを使います。misc（なんか）は空で構いません。")
      .addText((text) =>
        text.setValue(this.values.title).onChange((value) => {
          this.values.title = value;
        })
      );

    // タグはカンマ区切りにせず、1件ずつ追加・削除できる形にする。
    const tagsSetting = new Setting(contentEl)
      .setName("タグ")
      .setDesc("1件ずつ追加します。最大10件。");
    this.tagsEl = tagsSetting.controlEl.createDiv({ cls: "slytxt-tags" });
    this.renderTags();

    const descriptionSetting = new Setting(contentEl)
      .setName("説明文")
      .setDesc("空なら本文の書き出しから作ります。")
      .addTextArea((text) => {
        this.descriptionInput = text;
        text.inputEl.rows = 3;
        text.setValue(this.values.description).onChange((value) => {
          this.values.description = value;
        });
      });
    descriptionSetting.addButton((button) =>
      button.setButtonText("本文から候補を作る").onClick(() => {
        const candidate = deriveDescription(this.options.bodyText);
        if (!candidate) {
          new Notice("本文が空なので候補を作れません。");
          return;
        }
        this.values.description = candidate;
        this.descriptionInput?.setValue(candidate);
      })
    );

    const coverSetting = new Setting(contentEl)
      .setName("カバー画像")
      .setDesc(
        this.options.autoCoverUrl && !this.values.cover
          ? "未指定なら、本文の最初の画像がカバーになります。"
          : "media.slytxt.dev の URL。空なら本文の最初の画像がカバーになります。"
      )
      .addText((text) => {
        this.coverInput = text;
        text.setPlaceholder("https://media.slytxt.dev/…");
        text.setValue(this.values.cover).onChange((value) => {
          this.values.cover = value.trim();
          this.renderCoverPreview();
        });
      });
    coverSetting.addButton((button) =>
      button.setButtonText("画像をアップロード").onClick(async () => {
        button.setDisabled(true);
        try {
          const url = await this.options.onUploadCover();
          if (url) {
            this.values.cover = url;
            this.coverInput?.setValue(url);
            this.renderCoverPreview();
          }
        } catch {
          // エラー通知は呼び出し側が出す。
        } finally {
          button.setDisabled(false);
        }
      })
    );
    this.coverPreview = contentEl.createEl("img", { cls: "slytxt-cover-preview" });
    this.renderCoverPreview();

    new Setting(contentEl)
      .addButton((button) =>
        button
          .setButtonText("公開する")
          .setCta()
          .onClick(async () => {
            if (this.publishing) return;
            this.publishing = true;
            button.setDisabled(true);
            button.setButtonText("公開しています…");
            try {
              await this.onPublish({ ...this.values, tags: [...this.values.tags] });
              this.close();
            } catch {
              // エラー通知は呼び出し側が出す。画面は開いたままにして直せるようにする。
              button.setDisabled(false);
              button.setButtonText("公開する");
              this.publishing = false;
            }
          })
      )
      .addButton((button) =>
        button.setButtonText("キャンセル").onClick(() => this.close())
      );
  }

  /** タグのチップと追加欄を描き直す。 */
  private renderTags(): void {
    if (!this.tagsEl) return;
    const el = this.tagsEl;
    el.empty();
    for (const tag of this.values.tags) {
      const chip = el.createSpan({ cls: "slytxt-tag-chip" });
      chip.createSpan({ text: tag });
      const remove = chip.createEl("button", { text: "×", cls: "slytxt-tag-remove" });
      remove.addEventListener("click", () => {
        this.values.tags = this.values.tags.filter((t) => t !== tag);
        this.renderTags();
      });
    }
    const input = el.createEl("input", {
      type: "text",
      cls: "slytxt-tag-input",
      placeholder: "タグを入力"
    });
    const add = el.createEl("button", { text: "追加", cls: "slytxt-tag-add" });
    const commit = () => {
      const value = input.value.trim();
      if (
        value &&
        !this.values.tags.includes(value) &&
        this.values.tags.length < 10
      ) {
        this.values.tags.push(value);
      }
      this.renderTags();
    };
    add.addEventListener("click", commit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
      }
    });
  }

  /** カバー（指定値か、自動候補）のプレビューを出す。 */
  private renderCoverPreview(): void {
    if (!this.coverPreview) return;
    const url = this.values.cover || this.options.autoCoverUrl || "";
    if (url) {
      this.coverPreview.src = url;
      this.coverPreview.style.display = "";
    } else {
      this.coverPreview.removeAttribute("src");
      this.coverPreview.style.display = "none";
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
