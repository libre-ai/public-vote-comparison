// Boussole service-worker generator (build-time). The emitted worker caches the
// app SHELL on install and, on fetch, serves cache-first ONLY for GET requests
// that are both (a) same-origin and (b) whose path is in the shell `assets`
// allowlist — falling back to the network solely for those same-origin shell
// assets. It NEVER touches user responses (those live only in IndexedDB) and
// NEVER reaches a cross-origin or non-shell URL, so its single `fetch` is the
// serving of the app shell, not user-data transmission.
//
// This is the ONE file the no-transmission guard allowlists by name (with this
// rationale): a PWA service worker unavoidably uses `fetch` to serve its shell,
// and that use is provably local/same-origin/shell-only here. Keep this file's
// only `fetch` exactly this shell-first pattern; do not add any other network
// access. Any change here must be re-reviewed for the same guarantee.
export function renderServiceWorker(assets: readonly string[], cacheDigest: string): string {
  return `const ASSETS=${JSON.stringify(assets)};
const CACHE="libre-ai-boussole-${cacheDigest}";
self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))));
self.addEventListener("fetch",event=>{const url=new URL(event.request.url);if(event.request.method==="GET"&&url.origin===location.origin&&ASSETS.includes(url.pathname)){event.respondWith(caches.match(event.request).then(cached=>cached??fetch(event.request)));}});
`;
}
