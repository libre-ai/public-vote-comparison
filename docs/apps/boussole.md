# Boussole

- **Path:** `apps/boussole`
- **Owner:** Experiences / Boussole
- **Runtime:** Bun/React static/PWA plus pure Rust/WASM scoring core
- **Tenant model:** public datasets and entirely local personal response workspace

## Purpose and actors

Boussole lets a person compare locally expressed priorities with sourced public votes using a transparent bounded method, without account, political profiling or voting advice. Dataset editors prepare sources; independent methodological and legal reviewers gate public scoring; users keep responses on device.

## Journeys

1. **Inspect method first:** user reads dataset version, selection method, scoring formula, abstention/non-vote treatment, limitations and review evidence.
2. **Respond locally:** user answers symmetric sourced statements; responses persist only locally and can be skipped/deleted.
3. **Compute/inspect:** deterministic WASM computes comparison with visible denominator, missing data and per-statement contribution; user can reproduce/export locally.
4. **Update/delete:** user previews dataset/method changes before recomputation, exports a non-identifying local result or deletes all responses.

## Non-goals

- voting recommendation, ideology label, moral ranking, representative poll or candidate endorsement ;
- account, server response storage, telemetry or ad profile ;
- model-generated statement publication without human review ;
- hiding abstention, absence, dataset selection or denominator ;
- public scoring before the two ADR-0002 approvals.

## Domain protocol

**Commands:** `ImportPublicVoteDataset`, `SubmitDatasetForReview`, `ApproveMethodVersion`, `StartLocalQuestionnaire`, `RecordLocalResponse`, `SkipStatement`, `ComputeLocalComparison`, `ExportLocalResult`, `DeleteLocalResponses`.

**Queries:** `GetPublishedDataset`, `GetMethodVersion`, `GetStatementSources`, `PreviewDatasetUpgrade`, `GetLocalProgress`, `ExplainComparison`.

**Events:** public build events `DatasetValidated`, `MethodVersionApproved`, `DatasetPublished`; local-only events `LocalResponseRecorded`, `ComparisonComputed`, `LocalResponsesDeleted` are never transmitted.

Method/dataset versions are immutable and content-addressed. Result binds exact method, dataset and response-set hashes.

## Refusal matrix

| Code | Refusal |
| --- | --- |
| `boussole.public_scoring_disabled` | independent release approvals absent |
| `boussole.dataset_unsourced` | vote/statement lacks source and extraction method |
| `boussole.wording_asymmetric` | review gate detects unequal framing contract |
| `boussole.coverage_insufficient` | hash-bound aggregation floor or stricter dataset threshold not met |
| `boussole.denominator_hidden` | result cannot expose votes considered/omitted |
| `boussole.method_version_unknown` | scoring core lacks approved method vector |
| `boussole.response_transmission_forbidden` | request attempts network upload of positions |
| `boussole.local_state_corrupt` | local response envelope fails validation/hash |

Failure shows no guessed score and preserves source/method access.

## Data

Git/contracts own identity-free aggregate statements, vote counts, extraction provenance, opaque review references and methods. Every dataset declares a hash-bound publication policy with a group-size floor of at least 5, small-group exclusion, prohibited identity fields and a review expiry; a real review may require a higher threshold. Roll-call sources are admitted only as aggregates. Each statement declares a public-policy subject and prohibited person targeting; its human wording is hash-bound and any change requires a fresh privacy attestation. User responses and results are IndexedDB/local memory only until deletion. No server table, cookie identity or analytics ID is allowed. Dataset source licence and permitted redistribution are explicit per field/artifact. Migration source is approved public vote datasets and methods; no historical user response enters the new app.

## Authentication and authorization

Public data/method reads require no authentication. Build publication uses release identity and attenuated Biscuit with `tenant("public")`, restricted to dataset/method hash and `publish`. Payloads carry only opaque `rev_*` reviewer IDs plus sanitized HTTPS attestation citations and hashes. The release caller verifies professional capacity and explicit publication consent; those attestations are not account data and are never resolved by the scorer. There is no browser session or internal token in scoring.

## Runtime boundaries

TypeScript owns questionnaire, local persistence, upgrade preview and explanation UI. Boussole Scoring v2 is a candidate Rust/WASM boundary for pure deterministic comparison and method validation only; this amendment implements no engine. The future component has no network, clock, storage, randomness, identity or personal identifier. Inputs/outputs are canonical local contract values. Dataset extraction tooling cannot share user runtime.

## Accessibility and degraded mode

The complete questionnaire and result work offline after dataset load. Statements, skip controls, denominator, abstentions and uncertainty are screen-reader/keyboard accessible and not color-only. Long comparison tables provide summaries and per-row detail. If WASM fails, scoring is unavailable rather than replaced by a different JS formula; method/source reading and local export/delete remain available.

## Contracts

- Public Vote Dataset v2 — `contracts/schemas/public-vote-dataset.v2.schema.json` ;
- Boussole Method v2 — `contracts/schemas/boussole-method.v2.schema.json` ;
- Local Response Set v2 — `contracts/schemas/boussole-response-set.v2.schema.json` ;
- Local Comparison v2 — `contracts/schemas/local-comparison.v2.schema.json` ;
- pure scoring candidate — `contracts/wit/boussole-scoring-v2/world.wit` and `SEMANTICS.md` ;
- public test vectors — `contracts/fixtures/boussole-scoring-v2/golden-vectors.v1.json`.

No API accepts responses.

## Evidence

Golden scoring vectors run in Rust/WASM and independent reference implementation. Dataset tests validate sources, aggregation floors, small-group exclusion, publication expiry, person-targeting declarations, wording reapproval, denominators, abstentions, attestations and licences. Network interception proves zero response/result transmission. Browser tests cover offline, upgrade preview, delete, keyboard and screen readers. Release evidence includes the independent methodological and legal/privacy approvals defined by ADR-0002.

## Work packages

1. dataset/method/result contracts and review fixtures — Canonical Core ;
2. Rust scorer and independent reference vectors — Specialized Rust ;
3. local questionnaire/explanation PWA — Experiences ;
4. dataset extraction/provenance pipeline — Proof + Experiences ;
5. methodological/legal/accessibility/privacy gate — independent reviewers + Infrastructure and Release.

Public scoring remains compile/release-disabled until distinct named methodology and France/EU privacy reviewers approve the exact method/dataset hashes. No agent, dataset editor or future implementer can approve its own output.

## Release and rollback

Code/dataset previews may ship without public scoring. Public scoring release requires ADR-0002 authority, fixed dataset/method hashes, golden equality, zero-transmission proof and accessibility review. Rollback restores previous app/dataset while retaining local responses under compatible statement IDs; incompatible upgrade requires user-confirmed export/reset. No release or rollback sends positions.
