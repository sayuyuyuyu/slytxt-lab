import { App, MarkdownView, Notice, Plugin, TFile, requestUrl, type Editor } from "obsidian";
import { EmbedModal } from "./src/embed-modal";
import { PublishModal, type PublishScreenValues } from "./src/publish-modal";
import { publishNote, type GitHubRequest, type GitHubResponse } from "./src/lib/github";
import { classifyEmbedUrl, embedInsertion, embedLabel } from "./src/lib/embed";
import { MAX_COVER_BYTES, MediaError, uploadCover, type MediaRequest } from "./src/lib/media";
import { extractExtras } from "./src/lib/frontmatter";
import {
  deriveDescription,
  firstImageSource,
  preparePublish,
  splitHeadingTitle
} from "./src/lib/publish-plan";
import { PublishError } from "./src/lib/github";
import { isPublishCategory, todayInTokyo, type PublishCategory } from "./src/lib/slug";
import { DEFAULT_SETTINGS, SlytxtSettingTab, type SlytxtSettings } from "./src/settings";

export default class SlytxtPublishPlugin extends Plugin {
  settings: SlytxtSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new SlytxtSettingTab(this.app, this));

    this.addCommand({
      id: "publish-pull-request",
      name: "公開（項目の確認・編集）",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (!checking) void this.openPublishScreen(file);
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

    this.addRibbonIcon("send", "公開（項目の確認・編集）", () => {
      const file = this.app.workspace.getActiveFile();
      if (!file || file.extension !== "md") {
        new Notice("Markdown ファイルを開いてから押してください。");
        return;
      }
      void this.openPublishScreen(file);
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
            .setTitle("公開する（項目の確認・編集）")
            .setIcon("send")
            .onClick(() => {
              void this.openPublishScreen(file);
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

  /** 現在の frontmatter から公開画面の初期値を決める。 */
  private currentValues(file: TFile): PublishScreenValues {
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

  /**
   * 公開画面を開く。編集はすべてこの画面で完結する。
   * 初期値は本文から補う：タイトルは最初の見出し、説明は書き出し、
   * カバーは本文の最初の画像（URL の場合）。
   */
  private async openPublishScreen(file: TFile): Promise<void> {
    const values = this.currentValues(file);
    const raw = await this.app.vault.read(file);
    const bodyText = raw.replace(/^---\n[\s\S]*?\n---\n?/, "");
    if (!values.title && values.category !== "misc") {
      const heading = splitHeadingTitle(bodyText);
      if (heading) values.title = heading.heading;
    }
    if (!values.description) {
      values.description = deriveDescription(bodyText);
    }
    const firstImage = firstImageSource(bodyText);
    const autoCoverUrl =
      firstImage && /^https?:\/\//.test(firstImage) ? firstImage : undefined;
    new PublishModal(this.app, values, {
      bodyText,
      ...(autoCoverUrl ? { autoCoverUrl } : {}),
      onUploadCover: async () => {
        try {
          return await this.pickAndUploadCover();
        } catch (error) {
          new Notice(error instanceof Error ? error.message : String(error), 12000);
          return "";
        }
      },
      onPublish: async (screenValues) => {
        try {
          await this.publishFromScreen(file, screenValues, bodyText);
        } catch (error) {
          const message =
            error instanceof PublishError || error instanceof Error
              ? error.message
              : String(error);
          new Notice(`公開に失敗しました: ${message}`, 12000);
          throw error;
        }
      }
    }).open();
  }

  /** 画像を選ばせてアップロードし、公開 URL を返す（frontmatter にはまだ書かない）。 */
  private async pickAndUploadCover(): Promise<string> {
    if (!this.settings.uploadToken) {
      throw new MediaError("設定でアップロード用トークンを登録してください。");
    }
    const picked = await pickImageFile();
    if (!picked) throw new MediaError("画像が選ばれませんでした。");
    new Notice("カバー画像をアップロードしています…");
    return uploadCover(
      this.mediaRequest(),
      this.settings.uploadToken,
      picked.bytes,
      picked.mime,
      crypto.randomUUID()
    );
  }

  /** 画像ファイルを選ばせて media Worker へ上げ、frontmatter の cover に URL を差す。 */
  private async uploadCoverFor(file: TFile): Promise<string> {
    const url = await this.pickAndUploadCover();
    await this.app.fileManager.processFrontMatter(file, (front) => {
      front.cover = url;
    });
    new Notice(`カバーを設定しました: ${url}`, 8000);
    return url;
  }

  /**
   * カバー未指定のときの自動カバー。本文の最初の画像が URL ならそのまま、
   * Vault 内のファイルならアップロードして URL にする。
   * 取れない場合は空文字（カバーなしで公開する）。
   */
  private async resolveAutoCover(file: TFile, bodyText: string): Promise<string> {
    const source = firstImageSource(bodyText);
    if (!source) return "";
    if (/^https?:\/\//.test(source)) return source;
    if (!this.settings.uploadToken) return "";
    try {
      const target = this.app.metadataCache.getFirstLinkpathDest(source, file.path);
      if (!target) return "";
      const mime = MIME_BY_EXTENSION[target.extension.toLowerCase()];
      if (!mime) return "";
      const bytes = await this.app.vault.readBinary(target);
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_COVER_BYTES) return "";
      return await uploadCover(
        this.mediaRequest(),
        this.settings.uploadToken,
        bytes,
        mime,
        crypto.randomUUID()
      );
    } catch {
      return "";
    }
  }

  /** 公開画面で確定した値で PR を作り、使った値をノートの frontmatter にも残す。 */
  private async publishFromScreen(
    file: TFile,
    values: PublishScreenValues,
    bodyText: string
  ): Promise<void> {
    if (!this.settings.token) {
      throw new PublishError("設定で GitHub トークンを登録してください。");
    }
    const cover = values.cover || (await this.resolveAutoCover(file, bodyText));
    const body = await this.app.vault.read(file);
    const frontmatterMatch = body.match(/^---\n([\s\S]*?)\n---/);
    const cache = this.app.metadataCache.getFileCache(file);
    const payload = preparePublish(
      {
        name: file.basename,
        category: values.category,
        title: values.title,
        description: values.description,
        tags: values.tags,
        ...(cover ? { cover } : {}),
        published: (cache?.frontmatter?.published as string | undefined) ?? undefined,
        updated: (cache?.frontmatter?.updated as string | undefined) ?? undefined,
        extras: extractExtras(frontmatterMatch?.[1] ?? ""),
        body: bodyText
      },
      todayInTokyo()
    );

    new Notice("PR を作成しています…");
    const result = await publishNote(this.request(), this.settings, {
      category: payload.category,
      slug: payload.slug,
      title: payload.title,
      content: payload.content
    });
    await this.app.fileManager.processFrontMatter(file, (front) => {
      front.title = values.title;
      front.description = payload.frontmatter.description;
      front.tags = values.tags;
      front.cover = cover;
      front.category = values.category;
    });
    new Notice(
      result.autoMerge
        ? `PR #${result.prNumber} を作成しました（CI が通れば自動でマージされ、公開されます）: ${result.prUrl}`
        : `PR #${result.prNumber} を作成しました: ${result.prUrl}`,
      12000
    );
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

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp"
};

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
