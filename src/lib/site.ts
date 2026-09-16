export const site = {
  name: "slytxt.lab",
  title: "slytxt.lab",
  description:
    "AIやクラウドを試した記録と、日々のこと、つくったもの。",
  author: "slytxt",
  locale: "ja_JP",
  lang: "ja",
  twitter: "@sybtxt",
  xUrl: "https://x.com/sybtxt",
  noteUrl: "https://note.com/slytxt"
};

export const categoryLabels = {
  tech: "技術メモ",
  life: "日々の記録",
  projects: "つくったもの"
} as const;

export const articleSections = {
  tech: {
    title: categoryLabels.tech,
    eyebrow: "notes",
    description: "AI、MCP、クラウド、プログラミングを試した記録。",
    emptyTitle: "まだ記事はありません",
    emptyDescription: "最初の一本を書いたら、ここに並びます。"
  },
  life: {
    title: categoryLabels.life,
    eyebrow: "journal",
    description: "旅行、ゲーム、音楽、ガジェットの話。",
    emptyTitle: "まだ記録はありません",
    emptyDescription: "出かけたことや、気に入ったものを書きます。"
  }
} as const;

export const projectStatusLabels = {
  planning: "計画中",
  active: "進行中",
  maintenance: "保守中",
  paused: "休止中",
  completed: "完了"
} as const;
