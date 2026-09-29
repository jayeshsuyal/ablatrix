# Investigate before revising

On `/paid-review`, describe what is wrong, optionally choose a failure category, and select **Investigate and revise**. The reviewer can continue to another answer while the existing durable worker processes the job.

## What happens

1. A rule-based investigator routes the critique and ranks saved sources against the current question. It excludes customer answers whose original questions refer to conflicting model identifiers.
2. Wording, conflicting-source, and wrong-model corrections can use saved source candidates. An explicitly missed source can be reconsidered even if it was already available. Missing-evidence requests require newly supplied applicable content or external discovery; reranking the old packet does not count as finding new evidence.
3. If external discovery is enabled, the worker searches once and reads at most two permitted pages. Search snippets are leads only. Admitted page excerpts retain their URL, content hash, retrieval time, and source provenance.
4. With suitable source candidates, one answer call receives the selected excerpts, critique, and investigation summary. Without them, the job returns a specific clarification request and makes no answer call.

The visible trace records the diagnosis, query, selected and excluded sources, source reads, and stop reason. Matching identifiers and words only admits a source candidate. Neither source selection nor a literal quote check establishes that a compatibility claim is correct; the reviewer still checks the source and decides whether to accept the revision.

New investigated answers record `answer-revision-v3-investigation`; the response schema remains `answer_revision_v1`. Legacy direct revisions remain readable and retain their recorded protocol. An accepted case revision does not promote a global policy.

## Bounded external discovery

Discovery is **off by default**. Configure `ABLATRIX_REVISION_WEB=1` and `ABLATRIX_REVISION_SOURCE_DOMAINS` with one to ten exact public hostnames, separated by commas. There is no default approved host. Subdomains require their own entries. The existing `ABLATRIX_LOOP_LIVE=1`, server-side Sapiom credential, and local planning-ledger gates also apply. Customer questions and product titles form the external query; reviewer names and full clarifications are excluded, though identifiers from clarifications may be included.

The adapter uses the pinned Sapiom SDK search and scrape functions through the provider's bounded transport. Requests go to the fixed Sapiom capability endpoint. Page URLs and returned origins must remain on the configured HTTPS hosts; userinfo, explicit ports, IP literals, and malformed hosts are rejected. Each operation has a ten-second timeout and a 256 KiB response bound. Source excerpts are limited to 2,000 characters; the generation context remains bounded.

Before discovery, the worker checks shared capacity for up to **four operations: one search, two reads, and one answer**. Every dispatched operation separately reserves the configured planning allowance. This is a local allowance, not a settled charge or a provider-enforced spending cap. The overview distinguishes answer calls from search/read calls and includes both in totals.

Receipts use deterministic job-and-step identifiers and bind to the request content. Completed operations replay after restart without another dispatch. Pending, failed, mismatched, or unknown outcomes require reconciliation and retain their allowance; they are never silently retried. Clarification-only jobs do not consume the two-generation limit per case. Real answer reservations, including unsuccessful attempts, do consume it.

## Verification and current limits

Synthetic tests cover real Q19 source context, wrong-model exclusion, content novelty, source-selection bounds, clarification without generation, source provenance, receipt replay, uncertain outcomes, shared allowance accounting, and the review UI. No paid call was made for this implementation. It has not established a quality gain or Q19's correct replacement part.

This is a bounded investigation step within the existing revision worker. It is not a deployed Sapiom agent, an unrestricted research loop, or model fine-tuning. The production `agents.run` gates remain unchanged.
