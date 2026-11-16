import { App, Modal, Setting } from "obsidian";
import { isPublishCategory, type PublishCategory } from "./lib/slug";

export type FrontmatterValues = {
  category: PublishCategory;
  title: string;
  tags: string[];
  description: string;
  cover: string;
};

/**
 * frontmatter の入力フォーム。YAML を手で直す代わりに、公開に必要な項目を
 * ここで揃える（タイプミスを CI で知る形を避ける）。
 */
export class FrontmatterModal extends Modal {
  private values: FrontmatterValues;
  private readonly onSubmit: (values: FrontmatterValues) => void;

  constructor(app: App, initial: FrontmatterValues, onSubmit: (values: FrontmatterValues) => void) {
    super(app);
    this.values = { ...initial };
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "公開の項目" });

    new Setting(contentEl).setName("カテゴリ").addDropdown((dropdown) => {
      for (const category of ["tech", "journal", "notes"]) {
        dropdown.addOption(category, category);
      }
      dropdown.setValue(this.values.category).onChange((value) => {
        if (isPublishCategory(value)) this.values.category = value;
      });
    });

    new Setting(contentEl)
      .setName("タイトル")
      .setDesc("notes は空のままで構いません。空なら本文の書き出しで補います。")
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

    new Setting(contentEl)
      .setName("説明文")
      .setDesc("空なら本文の書き出しから作ります。")
      .addTextArea((text) => {
        text.inputEl.rows = 3;
        text.setValue(this.values.description).onChange((value) => {
          this.values.description = value;
        });
      });

    new Setting(contentEl)
      .setName("カバー画像の URL")
      .setDesc("media.slytxt.dev の URL（空ならカバーなし）。")
      .addText((text) =>
        text.setValue(this.values.cover).onChange((value) => {
          this.values.cover = value.trim();
        })
      );

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
