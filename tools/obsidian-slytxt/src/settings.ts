import { App, PluginSettingTab, Setting } from "obsidian";
import type SlytxtPublishPlugin from "../main";
import { PUBLISH_CATEGORIES, isPublishCategory, type PublishCategory } from "./lib/slug";

export type SlytxtSettings = {
  owner: string;
  repo: string;
  token: string;
  baseBranch: string;
  /** ノートの category が空・不正なときに埋める既定のカテゴリ。 */
  defaultCategory: PublishCategory;
  /** media Worker のアップロード用トークン（カバー画像のアップロードに使う）。 */
  uploadToken: string;
};

export const DEFAULT_SETTINGS: SlytxtSettings = {
  owner: "sayuyuyuyu",
  repo: "slytxt-lab",
  token: "",
  baseBranch: "main",
  defaultCategory: "misc",
  uploadToken: ""
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
      .setDesc("ノートの category が空・不正なときに埋めるカテゴリ。")
      .addDropdown((dropdown) => {
        for (const category of PUBLISH_CATEGORIES) {
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

    new Setting(containerEl)
      .setName("アップロード用トークン")
      .setDesc(
        "カバー画像を media.slytxt.dev へ上げるためのトークン（media Worker の UPLOAD_TOKEN と対）。端末のローカル設定にだけ保存されます。"
      )
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setValue(this.plugin.settings.uploadToken)
          .onChange(async (value) => {
            this.plugin.settings.uploadToken = value.trim();
            await this.plugin.saveSettings();
          });
      });
  }
}
