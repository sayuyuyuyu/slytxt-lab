import { App, Modal, Notice, Setting, type TextAreaComponent, type TextComponent } from "obsidian";
import { deriveDescription } from "./lib/publish-plan";
import { PUBLISH_CATEGORIES, isPublishCategory, type PublishCategory } from "./lib/slug";

export type FrontmatterValues = {
  category: PublishCategory;
  title: string;
  tags: string[];
  description: string;
  cover: string;
};

export type FrontmatterModalOptions = {
  /** 説明文の候補を作る材料（ノート本文）。 */
  bodyText?: string;
  /** カバー画像のアップロード。成功したら公開 URL を返す。 */
  onUploadCover?: () => Promise<string>;
};

/**
 * frontmatter の入力フォーム。YAML を手で直す代わりに、公開に必要な項目を
 * ここで揃える（タイプミスを CI で知る形を避ける）。
 */
export class FrontmatterModal extends Modal {
  private values: FrontmatterValues;
  private readonly onSubmit: (values: FrontmatterValues) => void;
  private readonly options: FrontmatterModalOptions;
  private descriptionInput: TextAreaComponent | null = null;
  private coverInput: TextComponent | null = null;

  constructor(
    app: App,
    initial: FrontmatterValues,
    onSubmit: (values: FrontmatterValues) => void,
    options: FrontmatterModalOptions = {}
  ) {
    super(app);
    this.values = { ...initial };
    this.onSubmit = onSubmit;
    this.options = options;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "公開の項目" });

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
      .setDesc("misc（なんか）は空のままで構いません。")
      .addText((text) =>
        text.setValue(this.values.title).onChange((value) => {
          this.values.title = value;
        })
      );

    new Setting(contentEl)
      .setName("タグ")
      .setDesc("カンマ区切り。最大10件。")
      .addText((text) =>
        text.setValue(this.values.tags.join(", ")).onChange((value) => {
          this.values.tags = value
            .split(/[,、]/)
            .map((tag) => tag.trim())
            .filter(Boolean);
        })
      );

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
    if (this.options.bodyText !== undefined) {
      descriptionSetting.addButton((button) =>
        button.setButtonText("本文から候補を作る").onClick(() => {
          const candidate = deriveDescription(this.options.bodyText ?? "");
          if (!candidate) {
            new Notice("本文が空なので候補を作れません。");
            return;
          }
          this.values.description = candidate;
          this.descriptionInput?.setValue(candidate);
        })
      );
    }

    const coverSetting = new Setting(contentEl)
      .setName("カバー画像の URL")
      .setDesc("media.slytxt.dev の URL（空ならカバーなし）。")
      .addText((text) => {
        this.coverInput = text;
        text.setValue(this.values.cover).onChange((value) => {
          this.values.cover = value.trim();
        });
      });
    if (this.options.onUploadCover) {
      coverSetting.addButton((button) =>
        button.setButtonText("画像をアップロード").onClick(async () => {
          button.setDisabled(true);
          try {
            const url = await this.options.onUploadCover?.();
            if (url) {
              this.values.cover = url;
              this.coverInput?.setValue(url);
            }
          } finally {
            button.setDisabled(false);
          }
        })
      );
    }

    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText("保存").setCta().onClick(() => {
          this.onSubmit(this.values);
          this.close();
        })
      )
      .addButton((button) => button.setButtonText("キャンセル").onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
