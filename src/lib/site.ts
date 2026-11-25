export const site = {
  name: "slytxt.dev",
  title: "slytxt.dev",
  description:
    "AIやクラウドを試した記録と、日々のこと、つくったもの。",
  locale: "ja_JP",
  lang: "ja",
  twitter: "@sybtxt",
  xUrl: "https://x.com/sybtxt",
  noteUrl: "https://note.com/slytxt"
};

export const categoryLabels = {
  tech: "Tech",
  misc: "Journal",
  comic: "Comic",
  game: "Game",
  anime: "Anime",
  projects: "Projects",
  about: "About"
} as const;

/** Where each collection lives in the URL space. */
export const categoryPaths = {
  tech: "/articles/tech/",
  misc: "/articles/misc/",
  comic: "/articles/comic/",
  game: "/articles/game/",
  anime: "/articles/anime/",
  projects: "/projects/"
} as const;

/** Empty-state headings: one pattern, "No <collection> yet", kept distinct from the 404 heading "Not found". */
export const emptyStateTitles = {
  articles: "No articles yet",
  projects: "No projects yet"
} as const;

export type ArticleSection = {
  title: string;
  description: string;
  emptyTitle: string;
};

export const articleSections: Record<"tech" | "misc" | "comic" | "game" | "anime", ArticleSection> = {
  tech: {
    title: categoryLabels.tech,
    description: "AI、MCP、クラウド、プログラミングを試した記録。",
    emptyTitle: emptyStateTitles.articles,
  },
  misc: {
    title: categoryLabels.misc,
    description: "どの区分にも入らないもの。短いメモや日々のこと。",
    emptyTitle: emptyStateTitles.articles,
  },
  comic: {
    title: categoryLabels.comic,
    description: "漫画の感想。ジャンプ感想など。",
    emptyTitle: emptyStateTitles.articles,
  },
  game: {
    title: categoryLabels.game,
    description: "ゲームの話。音ゲーの記録など。",
    emptyTitle: emptyStateTitles.articles,
  },
  anime: {
    title: categoryLabels.anime,
    description: "アニメの感想。",
    emptyTitle: emptyStateTitles.articles,
  }
};

/** The index page that gathers every category. */
export const articlesIndex: ArticleSection = {
  title: "Articles",
  description: "技術と漫画、ゲーム、アニメ、それ以外の記事。",
  emptyTitle: emptyStateTitles.articles,
};

/** Descriptions for the pages outside the article sections, shared by each page. */
export const pageDescriptions = {
  about: "しらゆ（slytxt）のプロフィール。",
  projects: "しらゆがつくっているものと、いまの進み具合。",
  feed: "短文のフィード。記事にするほどではないメモや写真を置いています。"
} as const;

export const projectStatusLabels = {
  planning: "Planning",
  active: "Active",
  maintenance: "Maintenance",
  paused: "Paused",
  completed: "Done"
} as const;

export type NavItem = { href: string; label: string; children?: NavItem[] };

// The menu is a small tree: Articles holds its collections, and the rest
// sit beside it. Lists of writing come first, then the ways to browse them.
export const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "writing",
    items: [
      {
        href: "/articles/",
        label: "Articles",
        children: [
          { href: "/articles/tech/", label: categoryLabels.tech },
          { href: "/articles/misc/", label: categoryLabels.misc },
          { href: "/articles/comic/", label: categoryLabels.comic },
          { href: "/articles/game/", label: categoryLabels.game },
          { href: "/articles/anime/", label: categoryLabels.anime }
        ]
      },
      { href: "/feed/", label: "Feed" }
    ]
  },
  {
    label: "works",
    items: [{ href: "/projects/", label: categoryLabels.projects }]
  },
  {
    label: "meta",
    items: [{ href: "/about/", label: "About" }]
  }
];
