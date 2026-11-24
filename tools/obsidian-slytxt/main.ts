import { MarkdownView, Notice, Plugin, TFile, requestUrl, type Editor } from "obsidian";
import { EmbedModal } from "./src/embed-modal";
import { publishNote, type GitHubRequest, type GitHubResponse } from "./src/lib/github";
import { classifyEmbedUrl, embedInsertion, embedLabel } from "./src/lib/embed";
import { MAX_COVER_BYTES, MediaError, uploadCover, type MediaRequest } from "./src/lib/media";
import { extractExtras } from "./src/lib/frontmatter";
import {
  addTags,
  barStateFromNote,
  frontmatterPatchFor,
  removeTag,
  type BarState
} from "./src/lib/bar";
import { publishBarExtension, type BarController, type BarSnapshot } from "./src/bar-widget";
import {
  deriveDescription,
  firstImageSource,
  preparePublish,
  splitHeadingTitle
} from "./src/lib/publish-plan";
import { PublishError } from "./src/lib/github";
import { isPublishCategory, todayInTokyo, type PublishCategory } from "./src/lib/slug";
import { DEFAULT_SETTINGS, SlytxtSettingTab, type SlytxtSettings } from "./src/settings";

/** ノートの frontmatter にある公開の項目。ノート画面のプロパティ欄で編集する。 */
type NoteValues = {
  category: PublishCategory;
  title: string;
  tags: string[];
  description: string;
  cover: string;
};

export default class SlytxtPublishPlugin extends Plugin {
  settings: SlytxtSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new SlytxtSettingTab(this.app, this));

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

    // 公開バー（設計案B、#849）。ノート画面の先頭に常に出し、値は
    // frontmatter から読む。開き直しやプロパティの変更でも描き直す。
    this.registerEditorExtension(publishBarExtension(this.barController()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.refreshBar()));
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (file === this.activeMarkdownFile()) this.refreshBar();
      })
    );

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

  /* ---- 公開バー（設計案B、#849） ---- */

  /** バーの再描画を購読しているウィジェット。 */
  private barListeners = new Set<() => void>();

  /** 公開中のノート（パス）。ボタンの表示に使う。 */
  private readonly publishingNow = new Set<string>();

  private refreshBar(): void {
    for (const listener of this.barListeners) listener();
  }

  private activeMarkdownFile(): TFile | null {
    const file = this.app.workspace.getActiveFile();
    return file && file.extension === "md" ? file : null;
  }

  /**
   * エディタの本文（未保存の編集を含む）。frontmatter は CM の文書に含まれる
   * ので、値の導出に使う前に取り除く（YAML を本文として読むと、タイトルや
   * 説明に `---` や `tags:` が入る）。
   */
  private activeBody(): string {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const raw = view?.editor.getValue() ?? "";
    return raw.replace(/^---\n[\s\S]*?\n---\n?/, "");
  }

  private noteState(file: TFile): BarState {
    const front = this.app.metadataCache.getFileCache(file)?.frontmatter ?? null;
    return barStateFromNote(front, this.activeBody(), this.settings.defaultCategory);
  }

  /** バーの操作を frontmatter に書き戻す（値の正は frontmatter のまま）。 */
  private async patchNote(
    file: TFile,
    update: (state: BarState) => BarState
  ): Promise<void> {
    const next = update(this.noteState(file));
    await this.app.fileManager.processFrontMatter(file, (front) => {
      for (const [key, value] of Object.entries(frontmatterPatchFor(next))) {
        front[key] = value;
      }
    });
    this.refreshBar();
  }

  private barController(): BarController {
    return {
      snapshot: (): BarSnapshot | null => {
        const file = this.activeMarkdownFile();
        if (!file) return null;
        return { ...this.noteState(file), publishing: this.publishingNow.has(file.path) };
      },
      setCategory: (category) => {
        const file = this.activeMarkdownFile();
        if (!file) return;
        void this.patchNote(file, (state) => ({ ...state, category }));
      },
      addTag: (input) => {
        const file = this.activeMarkdownFile();
        if (!file) return;
        void this.patchNote(file, (state) => ({ ...state, tags: addTags(state.tags, input) }));
      },
      removeTag: (tag) => {
        const file = this.activeMarkdownFile();
        if (!file) return;
        void this.patchNote(file, (state) => ({ ...state, tags: removeTag(state.tags, tag) }));
      },
      pickCover: () => {
        const file = this.activeMarkdownFile();
        if (!file) return;
        void this.setCoverFromPicker(file);
      },
      publish: () => {
        const file = this.activeMarkdownFile();
        if (!file) return;
        void this.publishFromBar(file);
      },
      subscribe: (listener) => {
        this.barListeners.add(listener);
        return () => this.barListeners.delete(listener);
      }
    };
  }

  /** バーから公開する。公開中はボタンを「公開中…」にする。 */
  private async publishFromBar(file: TFile): Promise<void> {
    if (this.publishingNow.has(file.path)) return;
    this.publishingNow.add(file.path);
    this.refreshBar();
    try {
      await this.publish(file);
    } finally {
      this.publishingNow.delete(file.path);
      this.refreshBar();
    }
  }

  /** バーのサムネイルを押したとき。選んだ画像をアップロードして cover にする。 */
  private async setCoverFromPicker(file: TFile): Promise<void> {
    try {
      const url = await this.pickAndUploadCover();
      await this.patchNote(file, (state) => ({ ...state, cover: url }));
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error), 12000);
    }
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

  /** 現在の frontmatter から公開の項目を読む。 */
  private currentValues(file: TFile): NoteValues {
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

  /**
   * ノートの frontmatter と本文から PR を作る。画面遷移はしない。
   * 未指定の項目は本文から補う：タイトルは最初の見出し、カバーは
   * 本文の最初の画像、説明は書き出し。使った値はノートにも残す。
   */
  private async publish(file: TFile): Promise<void> {
    if (!this.settings.token) {
      new Notice("設定で GitHub トークンを登録してください。");
      return;
    }
    const values = this.currentValues(file);
    const raw = await this.app.vault.read(file);
    const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---/);
    const bodyText = raw.replace(/^---\n[\s\S]*?\n---\n?/, "");
    const cover = values.cover || (await this.resolveAutoCover(file, bodyText));
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
    try {
      const result = await publishNote(this.request(), this.settings, {
        category: payload.category,
        slug: payload.slug,
        title: payload.title,
        content: payload.content
      });
      await this.app.fileManager.processFrontMatter(file, (front) => {
        front.title = payload.frontmatter.title;
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
