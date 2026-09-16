<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
<!-- Rewritten for the retained Libre AI portfolio on 2026-09-14; earlier revisions retain their original licensing. -->

# Libre AI Public Vote Comparison

## Intended use

A future tool for privately comparing a person's explicitly stated positions with sourced public votes. It aims to make individual comparisons inspectable: which public decision was compared, what was recorded, and what the comparison cannot establish.

This candidate defines a documentary product scope. It does not admit a complete comparison application, a reviewed real-world voting corpus, an executable example or a deployed service. Earlier application sources do not establish that those capabilities are available here.

## Product boundaries

The proposed comparison concerns public voting records and positions deliberately entered by the person. It must not infer a political identity, attach a political label or present a score as an explanation of someone's motives. An abstention, an absence and a vote must remain distinguishable where the source records them.

Private comparison is a requirement. No account requirement, local storage, encryption, absence of transmission or deletion guarantee is claimed as implemented by this document. Those properties need direct tests against the actual application, including its persistence and network behavior.

## Proposed contracts

- A public vote record identifies the jurisdiction, decision, source, observation date and recorded outcome, with missing data kept explicit.
- A voluntary position links an answer to the decision being compared without turning it into an inferred identity.
- A comparison result exposes the input records, treatment of missing or non-comparable cases, and the rule that produced each comparison.
- A local data lifecycle describes which personal inputs are stored, exported or deleted and how those outcomes are verified.

These are proposed boundaries, not canonical schemas or available APIs. Canonical exchange contracts require admission by Contracts. Rules for aggregating comparisons must be explicit and reviewed before any aggregate is offered.

## Activation criteria

Select a bounded real corpus for one jurisdiction and review its provenance, usage rights and coverage. Demonstrate a complete runnable journey using cited votes, including missing data and non-comparable cases. Independent tests must verify the comparison rules, network behavior, handling of personal inputs and local deletion across all storage used by the application. Review the exact implementation and evidence before declaring availability.

The jurisdiction, corpus and any aggregation rule remain open qualification choices. No ranking, recommendation of a political choice or political labeling is part of this documentary promise.

[Français](README.fr.md)

## Portfolio navigation

The links below describe the intended retained portfolio. Public availability and link reachability have not been verified for this candidate.

### Products

- [Libre AI Work Supervision](https://github.com/libre-ai/ai-work-supervision)
- [Libre AI Model Policy](https://github.com/libre-ai/ai-model-policy)
- [Libre AI Practice Workbench](https://github.com/libre-ai/ai-practice-workbench)
- [Libre AI Learning Session Facilitation](https://github.com/libre-ai/learning-session-facilitation)
- [Libre AI Personal Knowledge Notebook](https://github.com/libre-ai/personal-knowledge-notebook)
- [Libre AI Information Feed Filter](https://github.com/libre-ai/information-feed-filter)
- [Libre AI Travel Itinerary Planner](https://github.com/libre-ai/travel-itinerary-planner)
- [Libre AI Public Vote Comparison](https://github.com/libre-ai/public-vote-comparison)

### Components and tools

- [Libre AI Application Development Toolkit](https://github.com/libre-ai/application-development-toolkit)
- [Libre AI Schemas And Contracts](https://github.com/libre-ai/schemas-and-contracts)
- [Libre AI Collaborative Data Sync](https://github.com/libre-ai/collaborative-data-sync)
- [Libre AI Execution Continuity Evaluator](https://github.com/libre-ai/execution-continuity-evaluator)
- [Libre AI Execution Sandbox](https://github.com/libre-ai/execution-sandbox)
- [Libre AI Capability Authorization](https://github.com/libre-ai/capability-authorization)
- [Libre AI Organization Data Lifecycle](https://github.com/libre-ai/organization-data-lifecycle)
- [Libre AI Database Policy Inspector](https://github.com/libre-ai/database-policy-inspector)
- [Libre AI Artifact Verification](https://github.com/libre-ai/artifact-verification)

### Project

- [Libre AI](https://github.com/libre-ai/.github)
- [Libre AI Project Website](https://github.com/libre-ai/project-website)
- [Libre AI Project Governance](https://github.com/libre-ai/project-governance)



---

## Reviewed editorial source

[Reviewed material](https://github.com/libre-ai/public-vote-comparison/blob/aeb922896f11add55b9076933528df9c03233bc5/docs/portfolio-material.json)

SHA-256: `2a1d7cfc34a285aeb33bbbc7bdb49fd3a5a19eddf4dc268a7accaa3c4c057a5e`
