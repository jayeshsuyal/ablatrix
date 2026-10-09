# Investigate before revising

On `/review` for completed Product QA answers, or `/paid-review` for the pinned historical batch, describe what is wrong, optionally choose a failure category, and select **Investigate and revise**. The reviewer can continue to another answer while the same durable worker processes the job. See [workspace answer handoff and recovery](workspace-answer-review.md).

## What happens

1. A rule-based investigator routes the critique and ranks saved sources against the current question. It excludes customer answers whose original questions refer to conflicting model identifiers. The source check reports whether a candidate lacked a requested identifier, a fit/replacement relationship, or enough terms from the customer's question.
2. Wording, conflicting-source, and wrong-model corrections can use saved source candidates. An explicitly missed source can be reconsidered even if it was already available. Missing-evidence requests require newly supplied applicable content or external discovery; reranking the old packet does not count as finding new evidence.
3. If external discovery is enabled, the worker searches once and reads at most two permitted pages. Search snippets are leads only. Admitted page excerpts retain their URL, content hash, retrieval time, and source provenance.
4. With suitable source candidates, one answer call receives the selected excerpts, critique, and investigation summary. Without them, the job returns a specific clarification request and makes no answer call.

The visible trace records the diagnosis, query, selected and excluded sources, source reads, and stop reason. New search receipts distinguish an empty provider response from results excluded by the configured source checks, with bounded counts by reason. Older receipts retain unknown raw counts on replay. The raw rejected URLs and snippets are not stored in receipts. Matching identifiers and words only admits a source candidate. Neither source selection nor a literal quote check establishes that a compatibility claim is correct; the reviewer still checks the source and decides whether to accept the revision.

New investigated answers record `answer-revision-v3-investigation`; the response schema remains `answer_revision_v1`. Legacy direct revisions remain readable and retain their recorded protocol. An accepted case revision does not promote a global policy.

## Bounded external discovery

Discovery is **off by default**. Configure `ABLATRIX_REVISION_WEB=1` and `ABLATRIX_REVISION_SOURCE_DOMAINS` with one to ten exact public hostnames, separated by commas. There is no default approved host. Subdomains require their own entries. The existing `ABLATRIX_LOOP_LIVE=1`, server-side Sapiom credential, and local planning-ledger gates also apply. The bounded external query starts with identifiers from the customer question and clarifications, then question terms and a question-type hint such as replacement, dimensions, material, installation, or warranty. Product title words add context; identifiers appearing only in the listing are omitted. Reviewer names, critique text, and full clarifications are excluded.

The adapter uses the pinned Sapiom SDK search and scrape functions through the provider's bounded transport. Requests go to the fixed Sapiom capability endpoint. Page URLs and returned origins must remain on the configured HTTPS hosts; userinfo, explicit ports, IP literals, and malformed hosts are rejected. Each operation has a ten-second timeout and a 256 KiB response bound. Source excerpts are limited to 2,000 characters; the generation context remains bounded.

Before discovery, the worker checks shared capacity for up to **four operations: one search, two reads, and one answer**. Every dispatched operation separately reserves the configured planning allowance. This is a local allowance, not a settled charge or a provider-enforced spending cap. The overview distinguishes answer calls from search/read calls and includes both in totals.

Receipts use deterministic job-and-step identifiers and bind to the request content. A running job saves its search query before dispatch and resumes with that exact query after restart, including after a code update. Completed operations replay without another dispatch. Pending, failed, mismatched, or unknown outcomes require reconciliation and retain their allowance; they are never silently retried. Clarification-only jobs do not consume the two-generation limit per case. Real answer reservations, including unsuccessful attempts, do consume it.

## Verification and current limits

Synthetic tests cover the pinned 20-case batch's query construction, digit-bearing customer questions, real Q19 source context, wrong-model exclusion, content novelty, source-selection bounds, empty versus filtered search responses, source provenance, legacy and changed-query receipt replay, uncertain outcomes, shared allowance accounting, and the review UI. This general query and diagnostics update made no paid call. It has not established an answer-quality gain or Q19's correct replacement part.

This is a bounded investigation step within the existing revision worker. It is not a deployed Sapiom agent, an unrestricted research loop, or model fine-tuning. The production `agents.run` gates remain unchanged.
