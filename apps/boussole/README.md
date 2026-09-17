# @libre-ai/boussole

Boussole is the couche-1 civic self-positioning app. It runs a questionnaire
**entirely on the citizen's device**: answers are compared against reference
datasets to locate the respondent on published axes, and **nothing is
transmitted** — no response ever leaves local storage.

Work package: `WP-G3-B01`.

## Increment 1 — local response-set domain

`src/domain/response-set.ts` is the pure, offline heart of the local workflow. A
response set binds the exact `datasetId`/`datasetDigest` and `methodId`/
`methodDigest` hashes and holds one answer (integer in `[-5, 5]`) or one skip per
statement.

| Operation            | Guarantee                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| `startQuestionnaire` | fail-closed: malformed binding, empty/oversized (>1000) or duplicate/malformed statement ids are refused |
| `recordResponse`     | out-of-scale values and unknown statements refused; re-answering replaces in place                       |
| `skipStatement`      | abstention preserved, never hidden                                                                       |
| `deleteResponses`    | erases every response, keeps the binding to restart                                                      |
| `exportResponseSet`  | serializes to `boussole-response-set.v2`; empty export refused                                           |

Refusals share the canonical code `boussole.local_state_corrupt`. The
`response_transmission_forbidden` invariant is **structural** in this module: it
imports nothing and exposes no network path, so there is no channel to violate.
`exportResponseSet` returns a plain, serializable value for a **local file** — a
caller must not upload it. Downstream, the invariant is reinforced by the
absence of any API that accepts responses (spec §Non-goals).

## Increment 2 — local persistence core

`src/persistence/local-response-store.ts` lets a response set survive a reload
without ever leaving the device. It is storage-agnostic: a serializer, a
fail-closed deserializer, a `LocalResponseStore` port, and an in-memory adapter.

| Function                      | Guarantee                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `serializeResponseSet`        | encodes to a device-local string only (never a network payload)                                              |
| `deserializeResponseSet`      | rebuilds **through the domain** (`startQuestionnaire` + record/skip); any corruption → `local_state_corrupt` |
| `LocalResponseStore` port     | async `save` / `load` / `clear`; `load` surfaces corruption as a `corrupt` result rather than throwing       |
| `createInMemoryResponseStore` | stores the encoded string, so `load` runs the true decode path and rejects tampered bytes                    |

Because rehydration replays through the domain, a tampered store (an out-of-scale
value, an unknown statement id, a malformed binding) can never load into an
invalid state — it is refused, not silently accepted.

## Increment 3 — dataset-upgrade preview and response migration

`src/domain/upgrade-preview.ts` is the pure logic behind the "Update/delete"
journey: when a newer immutable dataset/method version appears, it decides what
happens to the local responses. Loss is always reported, never silent.

| Function           | Guarantee                                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `previewUpgrade`   | reports `carried` / `dropped` / `addedUnanswered`, `datasetChanged` / `methodChanged`, and `requiresConfirmation` (true iff a recorded response would be lost)                                         |
| `migrateResponses` | `(…, confirmed)` → `migrated` (set + `dropped`) / `needs_confirmation` (`dropped`, not performed) / `refused`; a lossy migration is **type-enforced** to require confirmation, a lossless one proceeds |

The three-state `migrateResponses` result makes the preview→confirm→migrate flow
enforced by the types: a lossy migration cannot silently drop a recorded position
— it returns `needs_confirmation` until the caller re-invokes with `confirmed`.

A dropped **skip** counts as a loss too — abstention is never silently discarded.
A method-only change keeps every response (same positions, new scoring lens) and
needs no confirmation. Both refuse a malformed new binding/statement set via the
domain (`boussole.local_state_corrupt`).

### Not yet built (deliberately deferred)

- The concrete **IndexedDB adapter** implementing `LocalResponseStore` (browser
  runtime) and the offline **PWA cockpit** (browser-tested, not bun-CI runnable).
- The deterministic **Rust/WASM scoring core** (`ComputeLocalComparison`) and the
  `ExplainComparison` view that consumes it: scoring is unavailable rather than
  approximated by a divergent JS formula.
- **Public scoring** stays compile-disabled until the two methodological and
  legal approvals required by `ADR-0002`.

## Increment 5 — client shell (walking skeleton)

The questionnaire is now a fully working **local-first web app**: an accessible
SSR baseline instantiates the bun-app pattern, hydrating on the client into an
interactive questionnaire that persists answers to IndexedDB and restores them
on reload — **entirely device-local**, no network path for user data.

### Server & rendering

`src/server/handler.ts` routes `/` via `renderSsrDocument()`, serving the app
as HTML; the `boussoleDocument()` descriptor (shared/document.tsx) specifies the
questionnaire component, the production client bundle (`/assets/app.js`), and the
PWA manifest. A `/api/health` health-check confirms the server is running.

### No-JavaScript baseline

`src/ui/questionnaire.tsx` renders statements as read-only: each statement
displays its current state (answered, skipped, or unanswered) and the full
`[-5, -3, 0, 3, 5]` scale as static prose. Interactive buttons live under the
`lai-enhanced-only` class, hidden by default; they appear only after hydration.
A user without JavaScript still gets the full questionnaire, fully accessible
via SkipLink, fieldset/legend, and explicit labels — no colour-only signalling.

### Client hydration & persistence

`src/client/app.tsx` hydrates the SSR markup with `hydrateDocument()`, injecting
the `createIndexedDbResponseStore()` adapter (real IndexedDB in the browser). The
`useQuestionnaire()` hook (use-questionnaire.ts) manages the interactive state:
on mount, it loads the persisted response set from IndexedDB; after each
interaction (answer, skip), it commits to both the React component state and the
store. A corrupt local store is surfaced fail-closed (status: `"corrupt"`), never
rehydrated. The initial hydration render matches the server output exactly, so
the transition is seamless.

### PWA shell

The build pipeline (`scripts/build.ts`) generates the app bundle, CSS foundation

- Tailwind utilities, and a static offline document (`/static/index.html`). The
  service worker (`scripts/build-service-worker.ts`) is generated at build time
  with a hash-versioned cache name; it installs by fetching the shell asset list
  (app bundle, styles, icon, manifest, static document), serves them cache-first
  for GET requests (same-origin only, paths in the allowlist), and cleans up old
  cache versions on activation. The single `fetch` listener is **shell-only** and
  is the documented exception in the `check-no-transmission` allowlist.

### Evidence

Unit tests verify the static render (no-JS baseline visible), the SSR wrapper
baseline (empty questionnaire, no store required), and the interactive hook
(mounting with IndexedDB, loading, answering, persisting). Playwright e2e tests
(chromium, firefox, webkit) confirm:

- **No-JS baseline**: statements render read-only; interactive buttons are
  `display:none`; the state is readable without JavaScript.
- **PWA offline**: the service worker caches the shell; after registration, a
  page reload offline serves the cached assets and the interactive app remains
  responsive.
- **Round-trip**: answering a statement → reloading → verifying the answer is
  restored from IndexedDB.
- **No transmission**: a network-interception assertion confirms no user data
  (response set, statement IDs, answers) is transmitted; the service worker's
  `fetch` is shell-only (GET, same-origin, allowlisted paths).

Deferred (out of scope): scoring UI, dataset/method upgrade UI.

## Increment 6 — data-ownership controls

An enhanced-only "Mes données" region (`src/ui/data-ownership.tsx`) surfaces the
export and delete behaviour the domain already carries, closing the "you own your
data" loop:

- **Export** — `useQuestionnaire().exportData()` returns the non-identifying
  `boussole-response-set.v2` document (or `null` when empty); the component writes
  it to a local `boussole-reponses.json` via a `Blob` + object URL + anchor
  download. This touches **no network primitive**, so `check-no-transmission` stays
  green with no allowlist entry (unlike the service worker, this path has no
  `fetch` at all); the helper lives inside the app so the guard scans it.
- **Delete** — `useQuestionnaire().deleteAll()` empties the responses through the
  domain (binding kept) and persists the emptied set, so a reload restores an empty
  questionnaire rather than the old answers. Deletion goes through an in-page
  two-step confirmation (never `window.confirm`), with an `aria-live` success
  message.

The region is `lai-enhanced-only` (a no-JS user has no client store to export or
delete), so the no-JS baseline is unchanged; export is disabled with a notice when
there is nothing to export. Three-engine e2e assert the download (filename +
document + **zero cross-origin traffic**), the confirmed delete round-trip, and the
cancel path.

Still deferred: dataset/method **upgrade UI** (blocked upstream on the public
dataset loader — a deliberate no-transmission decision), and **public scoring**
(gated by `ADR-0002`, compile-disabled until two methodological and legal
approvals).

## Increment 4 — IndexedDB adapter

`src/persistence/indexed-db-response-store.ts` is the on-device implementation of
`LocalResponseStore`, persisting the single encoded response-set string. The
`IDBFactory` is **injected** (a real `indexedDB` in the browser, a fake in tests),
so the adapter never reaches for an ambient global and is testable off-browser. It
mirrors the practices IndexedDB adapter's transaction discipline: completion
handlers are attached synchronously with the request, so a transaction can never
auto-commit before completion is observed.

The fail-closed decode stays in the persistence core — the adapter only reads the
stored string and hands it to `deserializeResponseSet`, so a corrupt or tampered
record surfaces as a `corrupt` result (`boussole.local_state_corrupt`), never a
rehydrated invalid set. It uses IndexedDB, no network (the `check-no-transmission`
gate covers it).

Verified against `fake-indexeddb` (real round-trip, not stubs): save/load, re-save
overwrites the single set, clear empties, a seeded corrupt record loads as `corrupt`,
and an un-openable factory rejects.

## License

EUPL-1.2.
