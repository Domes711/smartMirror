import { useAppSelector } from "@/app/hooks";
import { LABELS, type LabelDict } from "./labels";
import type { Lang } from "@/types";

/** String view over the dictionary — array-valued keys coerce to "". */
export type Labels = Record<string, string>;

export interface UseT {
  lang: Lang;
  en: boolean;
  /** String labels (the common case). */
  L: Labels;
  /** Raw dictionary, for the few array-valued keys (e.g. wsSuggest). */
  raw: LabelDict;
}

export function useT(): UseT {
  const lang = useAppSelector((s) => s.ui.lang);
  const raw = LABELS[lang];
  return { lang, en: lang === "en", L: raw as unknown as Labels, raw };
}
