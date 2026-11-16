/**
 * 短文フィード（D1）で使う型。Cloudflare の型定義に依存せず、必要な部分だけを持つ。
 * 読み取りは Pages Functions（functions/feed/）、書き込みは投稿用の Worker
 * （tools/feed-cloudflare、別 PR）が担う。
 */

/** 添付画像。実体は R2 の pub/ に置き、media.slytxt.dev から配信する。 */
export type FeedImage = {
  /** R2 のキー（pub/ を除いたファイル名）。 */
  key: string;
  /** 代替テキスト。空文字なら装飾扱いにはせず、そのまま alt="" で出す。 */
  alt: string;
  width?: number;
  height?: number;
};

/** 投稿に含まれる最初の URL のリンクカード。取得できなければ未設定。 */
export type FeedLink = {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  site?: string;
};

export type FeedPost = {
  id: string;
  body: string;
  /** ISO 8601（UTC）。 */
  createdAt: string;
  images: FeedImage[];
  link?: FeedLink;
};

/** D1 のうち使う部分だけ。テストでは差し替える。 */
export type FeedDatabase = {
  prepare(sql: string): FeedStatement;
};

export type FeedStatement = {
  bind(...values: unknown[]): FeedStatement;
  all<T = unknown>(): Promise<{ results?: T[] }>;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<unknown>;
};

/** Static Assets の取得だけ（公開ページの雛形を読み、投稿を差し込む）。 */
export type AssetFetcher = {
  fetch(input: string | URL | Request): Promise<Response>;
};

export type FeedEnv = {
  /** D1 バインディング。未設定なら空のフィードとして扱う。 */
  FEED?: FeedDatabase;
  /** Pages の Static Assets。 */
  ASSETS?: AssetFetcher;
};

/** ページあたりの件数。 */
export const FEED_PAGE_SIZE = 20;

/** D1 の行。列名は db/feed/0001_init.sql と対応。 */
export type FeedRow = {
  id: string;
  body: string;
  created_at: string;
  images: string;
  link: string | null;
};
