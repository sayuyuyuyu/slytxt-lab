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
  life: "Life",
  projects: "Projects"
} as const;

export const articleSections = {
  tech: {
    title: categoryLabels.tech,
    eyebrow: "notes",
    description: "AI、MCP、クラウド、プログラミングを試した記録。",
    emptyTitle: "No notes yet",
    emptyDescription: "The first one will show up here."
  },
  life: {
    title: categoryLabels.life,
    eyebrow: "journal",
    description: "旅行、ゲーム、音楽、ガジェットの話。",
    emptyTitle: "No entries yet",
    emptyDescription: "Trips, games, music and gadgets will show up here."
  }
} as const;

export const projectStatusLabels = {
  planning: "Planning",
  active: "Active",
  maintenance: "Maintenance",
  paused: "Paused",
  completed: "Done"
} as const;

// The menu is grouped by level: what I write, how to browse it, and the rest.
export type NavItem = { href: string; label: string };

export const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "content",
    items: [
      { href: "/tech/", label: categoryLabels.tech },
      { href: "/life/", label: categoryLabels.life },
      { href: "/projects/", label: categoryLabels.projects }
    ]
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
