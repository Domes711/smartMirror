import { useEffect, useMemo, useState } from "react";
import { useBrowseStoreInfiniteQuery } from "@/app/api/modulesApi";
import { mapStoreModule } from "@/app/connect";
import type { Module } from "@/types";

/** `value`, but only after it stopped changing for `ms` — so typing in the
 * search box doesn't fire a catalog request per keystroke. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** The store's browse list, lazily: pages of STORE_PAGE modules fetched over
 * HTTP as the user scrolls (`loadMore`), filtered server-side by q/tag. */
export function useStoreBrowse(q: string, tag: string | null, en: boolean, skip = false) {
  const arg = { q: useDebounced(q.trim()), tag };
  const res = useBrowseStoreInfiniteQuery(arg, { skip });
  const pages = res.data?.pages;
  const mods: Module[] = useMemo(() => {
    const seen = new Set<string>();
    const out: Module[] = [];
    for (const p of pages || [])
      for (const e of p.community) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        out.push(mapStoreModule(e, en));
      }
    return out;
  }, [pages, en]);
  return {
    mods,
    total: pages?.[0]?.total ?? null,
    hasMore: !!res.hasNextPage,
    loading: res.isFetching,
    error: res.isError,
    loadMore: () => {
      if (res.isFetching) return;
      if (res.isError && !pages?.length) res.refetch();
      else if (res.hasNextPage) res.fetchNextPage();
    },
  };
}
