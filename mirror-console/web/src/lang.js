// UI / catalog language for the console. The mirror is primarily Czech, so the
// store catalog and config wizards are fetched in Czech by default. Override
// with localStorage `mirrorLang` ("cs" | "en") for testing.
export function mirrorLanguage() {
  try {
    const v = localStorage.getItem("mirrorLang");
    if (v === "cs" || v === "en") return v;
  } catch {
    /* localStorage unavailable */
  }
  return "cs";
}
