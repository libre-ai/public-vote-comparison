import { hydrateDocument } from "@libre-ai/web-platform/client";
import { createIndexedDbResponseStore } from "../persistence/indexed-db-response-store";
import { boussoleDocument } from "../shared/document";
import { QuestionnaireApp } from "../ui/questionnaire-app";

// Hydrate with the real IndexedDB-backed app. The document's `app` node is replaced
// by the store-backed wrapper; its initial render (empty questionnaire) matches the
// server markup, then the mount effect loads the persisted set. Local-only: the
// store is the ONLY sink for answers; nothing is transmitted.
const store = createIndexedDbResponseStore(globalThis.indexedDB);
hydrateDocument({
  ...boussoleDocument(),
  app: <QuestionnaireApp store={store} />,
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  });
}
