import { App, Notice, Plugin, TFile, requestUrl } from "obsidian";
import { FrontmatterModal, type FrontmatterValues } from "./src/frontmatter-modal";
import { publishNote, type GitHubRequest, type GitHubResponse } from "./src/lib/github";
import { preparePublish } from "./src/lib/publish-plan";
import { PublishError } from "./src/lib/github";
import { isPublishCategory, todayInTokyo, type PublishCategory } from "./src/lib/slug";
import { DEFAULT_SETTINGS, SlytxtSettingTab, type SlytxtSettings } from "./src/settings";

export default class SlytxtPublishPlugin extends Plugin {
  settings: SlytxtSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new SlytxtSettingTab(this.app, this));

    this.addCommand({
      id: "edit-frontmatter",
      name: "公開の項目（タイトル・タグ・説明・カバー）を入力",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (!checking) this.openFrontmatterModal(file);
        return true;
      }
    });

    this.addCommand({
      id: "publish-pull-request",
      name: "PR を作る（公開）",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (!checking) void this.publish(file);
        return true;
      }
    });
  }

  async loadSettings(): Promise<void> {
    const stored = (await this.loadData()) as Partial<SlytxtSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** 現在の frontmatter からモーダルの初期値を決める。 */
  private currentValues(file: TFile): FrontmatterValues {
    const cache = this.app.metadataCache.getFileCache(file);
    const front = cache?.frontmatter ?? {};
    const tags = Array.isArray(front.tags)
      ? front.tags.map(String)
      : typeof front.tags === "string"
        ? front.tags.split(/[,、]/).map((tag: string) => tag.trim())
        : [];
    const category = String(front.category ?? this.settings.defaultCategory);
    return {
      category: isPublishCategory(category) ? category : this.settings.defaultCategory,
      title: String(front.title ?? ""),
      tags: tags.filter(Boolean),
      description: String(front.description ?? ""),
      cover: String(front.cover ?? "")
    };
  }

  private openFrontmatterModal(file: TFile): void {
    const initial = this.currentValues(file);
    new FrontmatterModal(this.app, initial, (values) => {
      void this.app.fileManager.processFrontMatter(file, (front) => {
        front.title = values.title;
        front.description = values.description;
        front.tags = values.tags;
        front.cover = values.cover;
        front.category = values.category;
      });
    }).open();
  }

  /** ノートの frontmatter と本文から PR を作る。 */
  private async publish(file: TFile): Promise<void> {
    if (!this.settings.token) {
      new Notice("設定で GitHub トークンを登録してください。");
      return;
    }
    const values = this.currentValues(file);
    const body = await this.app.vault.read(file);
    const withoutFrontmatter = body.replace(/^---\n[\s\S]*?\n---\n?/, "");
    const payload = preparePublish(
      {
        name: file.basename,
        category: values.category,
        title: values.title,
        description: values.description,
        tags: values.tags,
        cover: values.cover || undefined,
        published: (this.app.metadataCache.getFileCache(file)?.frontmatter?.published as
          | string
          | undefined) ?? undefined,
        body: withoutFrontmatter
      },
      todayInTokyo()
    );

    new Notice("PR を作成しています…");
    try {
      const result = await publishNote(this.request(), this.settings, {
        category: payload.category,
        slug: payload.slug,
        title: payload.title,
        content: payload.content
      });
      new Notice(`PR #${result.prNumber} を作成しました: ${result.prUrl}`, 12000);
    } catch (error) {
      const message =
        error instanceof PublishError || error instanceof Error
          ? error.message
          : String(error);
      new Notice(`公開に失敗しました: ${message}`, 12000);
    }
  }

  /** Obsidian の requestUrl を、テスト可能な GitHubRequest の形に合わせる。 */
  private request(): GitHubRequest {
    return async ({ url, method, headers, body }): Promise<GitHubResponse> => {
      const response = await requestUrl({
        url,
        method,
        headers,
        ...(body === undefined ? {} : { body }),
        throw: false
      });
      let json: unknown = null;
      try {
        json = response.json;
      } catch {
        json = null;
      }
      return { status: response.status, json, text: response.text };
    };
  }
}
