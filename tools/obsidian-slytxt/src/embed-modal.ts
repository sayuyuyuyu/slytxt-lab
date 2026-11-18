import { App, Modal, Setting } from "obsidian";

/** 埋め込み URL の入力モーダル。URL 1つを受け取り、呼び出し側がカーソル位置へ挿入する。 */
export class EmbedModal extends Modal {
  private url = "";
  private readonly onSubmit: (url: string) => void;

  constructor(app: App, onSubmit: (url: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "埋め込み URL を挿入" });
    contentEl.createEl("p", {
      text: "URL だけの段落として挿入します。YouTube / Spotify / X は埋め込みに、それ以外はリンクカードになります。"
    });

    new Setting(contentEl).setName("URL").addText((text) => {
      text.setPlaceholder("https://…").onChange((value) => {
        this.url = value.trim();
      });
      text.inputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this.submit();
        }
      });
    });

    new Setting(contentEl)
      .addButton((button) =>
        button
          .setButtonText("挿入")
          .setCta()
          .onClick(() => this.submit())
      )
      .addButton((button) => button.setButtonText("キャンセル").onClick(() => this.close()));
  }

  private submit(): void {
    if (!this.url) return;
    this.onSubmit(this.url);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
