import type { store as Store } from "@/app/store";
import { scenesApi } from "@/app/api/scenesApi";
import { modulesApi } from "@/app/api/modulesApi";
import { scenesActions } from "@/features/scenes/scenesSlice";
import { modulesActions } from "@/features/modules/modulesSlice";
import { buildUserScenes, mapStoreModule } from "@/app/connect";
import { setRuntimeCatalog } from "@/data/catalog";

type AppStore = typeof Store;

/**
 * Keeps app-wide derived state in sync with the live backend, reactively —
 * no imperative bootstrap thunk. Runs once at startup and again whenever the
 * underlying RTK Query cache changes (another tab/device applying a scene,
 * installing a module, …).
 */
export function startProfileSync(store: AppStore): void {
  let lastSceneKey = "";
  let lastCatalogTs = 0;

  store.subscribe(() => {
    const s = store.getState();

    // 1. scenes slice ← live layout store, for the currently-edited profile
    const en = s.ui.lang === "en";
    const userKey = s.scenes.userKey;
    const layoutSel = scenesApi.endpoints.getLayout.select()(s);
    const layout = layoutSel.data;
    if (layout && !s.scenes.editing) {
      const sceneKey = userKey + "|" + layoutSel.fulfilledTimeStamp;
      if (sceneKey !== lastSceneKey) {
        lastSceneKey = sceneKey;
        store.dispatch(scenesActions.loadFromBackend({ userKey, ...buildUserScenes(layout, userKey, en) }));
      }
    }

    // 2. runtime widget catalog ← store catalog (own + community)
    const catalogSel = modulesApi.endpoints.getStoreCatalog.select()(s);
    if (catalogSel.data && catalogSel.fulfilledTimeStamp !== lastCatalogTs) {
      lastCatalogTs = catalogSel.fulfilledTimeStamp || 0;
      const all = [...catalogSel.data.own, ...catalogSel.data.community];
      setRuntimeCatalog(all.map((e) => mapStoreModule(e, false)), all.map((e) => mapStoreModule(e, true)));
      store.dispatch(modulesActions.setInstalled(all.filter((e) => e.installed).map((e) => e.id)));
    }
  });
}
