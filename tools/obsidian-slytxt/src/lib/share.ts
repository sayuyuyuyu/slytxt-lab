import { publicUrl, type PublishCategory } from "./slug.ts";

/**
 * 公開後の共有リンク（#708）。
 *
 * 記事を公開したあと、X の投稿画面を開く導線に使う。文面はタイトル＋記事 URL で、
 * misc（Journal）はタイトルを持たないので入れない（呼び出し側が空文字を渡す）。
 */
export function xIntentUrl(title: string, articleUrl: string): string {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(String(title ?? ""))}&url=${encodeURIComponent(articleUrl)}`;
}

export type ShareTarget = {
  articleUrl: string;
  xUrl: string;
};

/** 公開したノートの記事 URL と X の投稿画面。記事 URL はサイトの規則から作る。 */
export function shareTarget(
  category: PublishCategory,
  slug: string,
  title: string,
): ShareTarget {
  const articleUrl = publicUrl(category, slug);
  return { articleUrl, xUrl: xIntentUrl(title, articleUrl) };
}
