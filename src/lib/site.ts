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
  tech: "Tech",
  journal: "Journal",
  notes: "Notes",
  projects: "Projects"
} as const;

/** Where each collection lives in the URL space. */
export const categoryPaths = {
  tech: "/articles/tech/",
  journal: "/articles/journal/",
  notes: "/notes/",
  projects: "/projects/"
} as const;

export type ArticleSection = {
  title: string;
  eyebrow: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
};

export const articleSections: Record<"tech" | "journal" | "notes", ArticleSection> = {
  tech: {
    title: categoryLabels.tech,
    eyebrow: "tech",
    description: "AI、MCP、クラウド、プログラミングを試した記録。",
    emptyTitle: "Content not found",
    emptyDescription: "The first one will show up here."
  },
  journal: {
    title: categoryLabels.journal,
    eyebrow: "journal",
    description: "旅行、ゲーム、音楽、ガジェットの話。",
    emptyTitle: "Content not found",
    emptyDescription: "Trips, games, music and gadgets will show up here."
  },
  notes: {
    title: categoryLabels.notes,
    eyebrow: "notes",
    description: "あとで記事にする前の、短いメモ。",
    emptyTitle: "Content not found",
    emptyDescription: "Short memos will show up here."
  }
};

/** The index page that gathers Tech and Journal. */
export const articlesIndex: ArticleSection = {
  title: "Articles",
  eyebrow: "articles",
  description: "技術系の記事と、それ以外の記事。",
  emptyTitle: "Content not found",
  emptyDescription: "Longer write-ups will show up here."
};

export const projectStatusLabels = {
  planning: "Planning",
  active: "Active",
  maintenance: "Maintenance",
  paused: "Paused",
  completed: "Done"
} as const;

export type NavItem = { href: string; label: string; children?: NavItem[] };

// The menu is a small tree: Articles holds its two collections, and the rest
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
          { href: "/articles/journal/", label: categoryLabels.journal }
        ]
      },
      { href: "/notes/", label: categoryLabels.notes }
    ]
  },
  {
    label: "works",
    items: [{ href: "/projects/", label: categoryLabels.projects }]
  },
  {
    label: "browse",
    items: [
      { href: "/tags/", label: "Tags" },
      { href: "/search/", label: "Search" }
    ]
  },
  {
    label: "meta",
    items: [{ href: "/about/", label: "About" }]
  }
];
