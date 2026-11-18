import { App, MarkdownView, Notice, Plugin, TFile, requestUrl, type Editor } from "obsidian";
import { EmbedModal } from "./src/embed-modal";
import { FrontmatterModal, type FrontmatterValues } from "./src/frontmatter-modal";
import { publishNote, type GitHubRequest, type GitHubResponse } from "./src/lib/github";
import { classifyEmbedUrl, embedInsertion, embedLabel } from "./src/lib/embed";
import { MediaError, uploadCover, type MediaRequest } from "./src/lib/media";
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
        if (!checking) void this.openFrontmatterModal(file);
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

    this.addCommand({
      id: "upload-cover",
      name: "カバー画像をアップロード",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (!checking) {
          void this.uploadCoverFor(file).catch((error: unknown) => {
            new Notice(error instanceof Error ? error.message : String(error), 12000);
          });
        }
        return true;
      }
    });

    this.addCommand({
      id: "insert-embed",
      name: "埋め込み URL を挿入",
      editorCallback: (editor) => {
        this.openEmbedModal(editor);
      }
    });
    this.addCommand({
      id: "seed-frontmatter",
      name: "公開の項目をノートに追加",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (!checking) void this.seedFrontmatter(file);
        return true;
      }
    });

    this.addCommand({
      id: "insert-image",
      name: "画像をアップロードして挿入",
      editorCallback: (editor) => {
        void this.insertUploadedImage(editor);
      }
    });

    this.addRibbonIcon("send", "PR を作る（公開）", () => {
      const file = this.app.workspace.getActiveFile();
      if (!file || file.extension !== "md") {
        new Notice("Markdown ファイルを開いてから押してください。");
        return;
      }
      void this.publish(file);
    });

    this.addRibbonIcon("image", "画像をアップロードして挿入", () => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view) {
        new Notice("ノートを開いてから押してください。");
        return;
      }
      void this.insertUploadedImage(view.editor);
    });

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        menu.addItem((item) => {
          item
            .setTitle("画像をアップロードして挿入")
            .setIcon("image")
            .onClick(() => {
              void this.insertUploadedImage(editor);
            });
        });
        menu.addItem((item) => {
          item
            .setTitle("埋め込み URL を挿入")
            .setIcon("link")
            .onClick(() => {
              this.openEmbedModal(editor);
            });
        });
      })
    );

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        menu.addItem((item) => {
          item
            .setTitle("PR を作る（公開）")
            .setIcon("send")
            .onClick(() => {
              void this.publish(file);
            });
        });
        menu.addItem((item) => {
          item
            .setTitle("公開の項目を入力")
            .setIcon("settings-2")
            .onClick(() => {
              void this.openFrontmatterModal(file);
            });
        });
        menu.addItem((item) => {
          item
            .setTitle("公開の項目をノートに追加")
            .setIcon("list-plus")
            .onClick(() => {
              void this.seedFrontmatter(file);
            });
        });
      })
    );
  }

  async loadSettings(): Promise<void> {
    const stored = (await this.loadData()) as Partial<SlytxtSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** 公開の項目（タイトル・カテゴリ・タグ・説明・カバー）を frontmatter に用意し、ノート上部のプロパティ欄で直接編集できるようにする。 */
  private async seedFrontmatter(file: TFile): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (front) => {
      if (front.title === undefined) front.title = "";
      if (front.category === undefined) front.category = this.settings.defaultCategory;
      if (front.tags === undefined) front.tags = [];
      if (front.description === undefined) front.description = "";
      if (front.cover === undefined) front.cover = "";
    });
    new Notice("公開の項目をノート上部のプロパティに追加しました。");
  }

  /** 画像を選ばせてアップロードし、カーソル位置へ Markdown 画像として差し込む。 */
  private async insertUploadedImage(editor: Editor): Promise<void> {
    try {
      if (!this.settings.uploadToken) {
        throw new MediaError("設定でアップロード用トークンを登録してください。");
      }
      const picked = await pickImageFile();
      if (!picked) return;
      new Notice("画像をアップロードしています…");
      const url = await uploadCover(
        this.mediaRequest(),
        this.settings.uploadToken,
        picked.bytes,
        picked.mime,
        crypto.randomUUID()
      );
      editor.replaceSelection(`![](${url})`);
      new Notice("画像を挿入しました。");
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error), 12000);
    }
  }

  /** 埋め込み URL の入力モーダルを開き、カーソル位置へ差し込む。 */
  private openEmbedModal(editor: Editor): void {
    new EmbedModal(this.app, (url) => {
      const info = classifyEmbedUrl(url);
      if (!info) {
        new Notice("URL として読めませんでした。");
        return;
      }
      editor.replaceSelection(embedInsertion(info.url));
      new Notice(`${embedLabel(info)}として挿入しました。`);
    }).open();
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

  private async openFrontmatterModal(file: TFile): Promise<void> {
    const initial = this.currentValues(file);
    const raw = await this.app.vault.read(file);
    const bodyText = raw.replace(/^---\n[\s\S]*?\n---\n?/, "");
    new FrontmatterModal(
      this.app,
      initial,
      (values) => {
        void this.app.fileManager.processFrontMatter(file, (front) => {
          front.title = values.title;
          front.description = values.description;
          front.tags = values.tags;
          front.cover = values.cover;
          front.category = values.category;
        });
      },
      {
        bodyText,
        onUploadCover: async () => {
          try {
            return await this.uploadCoverFor(file);
          } catch (error) {
            new Notice(error instanceof Error ? error.message : String(error), 12000);
            return "";
          }
        }
      }
    ).open();
  }

  /** 画像ファイルを選ばせて media Worker へ上げ、frontmatter の cover に URL を差す。 */
  private async uploadCoverFor(file: TFile): Promise<string> {
    if (!this.settings.uploadToken) {
      throw new MediaError("設定でアップロード用トークンを登録してください。");
    }
    const picked = await pickImageFile();
    if (!picked) throw new MediaError("画像が選ばれませんでした。");
    new Notice("カバー画像をアップロードしています…");
    const url = await uploadCover(
      this.mediaRequest(),
      this.settings.uploadToken,
      picked.bytes,
      picked.mime,
      crypto.randomUUID()
    );
    await this.app.fileManager.processFrontMatter(file, (front) => {
      front.cover = url;
    });
    new Notice(`カバーを設定しました: ${url}`, 8000);
    return url;
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
      new Notice(
        result.autoMerge
          ? `PR #${result.prNumber} を作成しました（CI が通れば自動でマージされ、公開されます）: ${result.prUrl}`
          : `PR #${result.prNumber} を作成しました: ${result.prUrl}`,
        12000
      );
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

  /** 二進数ボディ用（カバー画像のアップロード）。 */
  private mediaRequest(): MediaRequest {
    return async ({ url, method, headers, body }) => {
      const response = await requestUrl({ url, method, headers, body, throw: false });
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

/** 端末のファイル選択を開き、画像1枚の中身を返す。キャンセル時は null。 */
function pickImageFile(): Promise<{ bytes: ArrayBuffer; mime: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/gif,image/webp";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      void file
        .arrayBuffer()
        .then((bytes) => resolve({ bytes, mime: file.type }))
        .catch(() => resolve(null));
    });
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}
