import { App, Modal, Setting } from "obsidian";
import type { ShareTarget } from "./lib/share.ts";

export type PublishResult = ShareTarget & {
  prNumber: number;
  prUrl: string;
  autoMerge: boolean;
};

/**
 * 公開（PR 作成）の結果と、X への投稿導線を出す。
 * 記事はマージ後に見られるようになるため、その旨も書く（#708）。
 */
export class PublishResultModal extends Modal {
  private readonly result: PublishResult;

  constructor(app: App, result: PublishResult) {
    super(app);
    this.result = result;
  }

  onOpen(): void {
    const { contentEl, result } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: `PR #${result.prNumber} を作成しました` });
    contentEl.createEl("p", {
      text: result.autoMerge
        ? "CI が通ると自動でマージされ、公開されます。公開ページはマージの数十秒後から見られます。"
        : "GitHub でマージすると公開されます。公開ページはマージの数十秒後から見られます。"
    });
    contentEl.createEl("p", { text: result.articleUrl });

    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText("PR を開く").onClick(() => window.open(result.prUrl, "_blank"))
      )
      .addButton((button) =>
        button
          .setButtonText("X に投稿")
          .setCta()
          .onClick(() => window.open(result.xUrl, "_blank"))
      )
      .addButton((button) => button.setButtonText("閉じる").onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
