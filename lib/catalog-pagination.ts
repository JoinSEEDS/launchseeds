import type { TokenCardData } from "../app/components/token-cards";
export type CatalogFilter = "all" | "scheduled" | "live";
export type CatalogPage = {
  items: TokenCardData[];
  filter: CatalogFilter;
  q: string;
  total: number;
  pageSize: number;
  next: string | null;
  previous: string | null;
};
export function catalogHref(page: Pick<CatalogPage, "filter" | "q">, direction?: "after" | "before", cursor?: string | null) {
  const query = new URLSearchParams();
  if (page.filter !== "all") query.set("filter", page.filter);
  if (page.q) query.set("q", page.q);
  if (direction && cursor) query.set(direction, cursor);
  const text = query.toString();
  return "/" + (text ? "?" + text : "");
}
