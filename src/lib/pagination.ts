export const PAGE_SIZE = 10;

export type PageData<T> = {
  entries: T[];
  totalEntries: number;
  currentPage: number;
  totalPages: number;
  prevUrl?: string;
  nextUrl?: string;
};

export function pagePath(basePath: string, page: number): string {
  return page === 1 ? `${basePath}/` : `${basePath}/page/${page}/`;
}

export function pageCount(totalEntries: number, pageSize = PAGE_SIZE): number {
  if (!Number.isInteger(pageSize) || pageSize < 1)
    throw new RangeError("pageSize must be a positive integer");
  return Math.max(1, Math.ceil(totalEntries / pageSize));
}

export function paginateEntries<T>(
  entries: T[],
  basePath: string,
  page = 1,
  pageSize = PAGE_SIZE,
): PageData<T> {
  const totalPages = pageCount(entries.length, pageSize);
  const currentPage = Number.isFinite(page)
    ? Math.min(Math.max(Math.floor(page), 1), totalPages)
    : 1;
  const start = (currentPage - 1) * pageSize;
  return {
    entries: entries.slice(start, start + pageSize),
    totalEntries: entries.length,
    currentPage,
    totalPages,
    prevUrl: currentPage > 1 ? pagePath(basePath, currentPage - 1) : undefined,
    nextUrl:
      currentPage < totalPages
        ? pagePath(basePath, currentPage + 1)
        : undefined,
  };
}

/** First, last, and neighboring pages stay reachable without overflowing small screens. */
export function visiblePages(
  currentPage: number,
  totalPages: number,
): (number | "gap")[] {
  const pages =
    totalPages <= 7
      ? Array.from({ length: totalPages }, (_, index) => index + 1)
      : [1, currentPage - 1, currentPage, currentPage + 1, totalPages].filter(
          (page) => page >= 1 && page <= totalPages,
        );
  const result: (number | "gap")[] = [];
  let previous = 0;
  for (const page of [...new Set(pages)].sort((a, b) => a - b)) {
    if (previous && page - previous > 1) result.push("gap");
    result.push(page);
    previous = page;
  }
  return result;
}
