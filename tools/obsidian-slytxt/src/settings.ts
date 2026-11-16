import { App, PluginSettingTab, Setting } from "obsidian";
import type SlytxtPublishPlugin from "../main";
import { isPublishCategory, type PublishCategory } from "./lib/slug";

export type SlytxtSettings = {
  owner: string;
  repo: string;
  token: string;
  baseBranch: string;
  /** frontmatter モーダルで最初に選ばれるカテゴリ。 */
  defaultCategory: PublishCategory;
};

export const DEFAULT_SETTINGS: SlytxtSettings = {
  owner: "sayuyuyuyu",
  repo: "slytxt-lab",
  token: "",
  baseBranch: "main",
  defaultCategory: "journal"
};

export class SlytxtSettingTab extends PluginSettingTab {
  plugin: SlytxtPublishPlugin;

  constructor(app: App, plugin: SlytxtPublishPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("GitHub のオーナー")
      .setDesc("公開先リポジトリのオーナー。")
      .addText((text) =>
        text.setValue(this.plugin.settings.owner).onChange(async (value) => {
          this.plugin.settings.owner = value.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("リポジトリ")
      .setDesc("公開先のリポジトリ名。")
      .addText((text) =>
        text.setValue(this.plugin.settings.repo).onChange(async (value) => {
          this.plugin.settings.repo = value.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("ベースブランチ")
      .setDesc("PR の向き先。通常は main。")
      .addText((text) =>
        text.setValue(this.plugin.settings.baseBranch).onChange(async (value) => {
          this.plugin.settings.baseBranch = value.trim() || "main";
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("既定のカテゴリ")
      .setDesc("frontmatter モーダルで最初に選ばれるカテゴリ。")
      .addDropdown((dropdown) => {
        for (const category of ["tech", "journal", "notes"]) {
          dropdown.addOption(category, category);
        }
        dropdown.setValue(this.plugin.settings.defaultCategory).onChange(async (value) => {
          if (isPublishCategory(value)) {
            this.plugin.settings.defaultCategory = value;
            await this.plugin.saveSettings();
          }
        });
      });

    new Setting(containerEl)
      .setName("GitHub のトークン")
      .setDesc(
        "fine-grained PAT（対象リポジトリの Contents: Read and write と Pull requests: Read and write）。端末のローカル設定にだけ保存されます。"
      )
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("github_pat_…")
          .setValue(this.plugin.settings.token)
          .onChange(async (value) => {
            this.plugin.settings.token = value.trim();
            await this.plugin.saveSettings();
          });
      });
  }
}
