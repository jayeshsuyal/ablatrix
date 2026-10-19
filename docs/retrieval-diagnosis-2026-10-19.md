# Retrieval stages and three-context answer diagnosis

October 19, 2026. The local cross-encoder trial did **not** recover the torch's three designated runtime facts. No answer was generated, paid plan qualified, default changed, or answer-quality gain measured. All twelve products are exposed development data from the failed v2 study.

## Findings

The torch question remains exactly “hi, once filled how long do they last on average?” The >6-hour listing claim, 5–6-hour customer report and nearly eight-hour report all enter the hybrid candidate pool. Their fused positions are 10, 9 and 7 respectively. All are lost at the five-chunk selection limit. Parent restoration cannot restore an unselected chunk; v2 supplementation adds none. This is an observed selection failure, not a candidate-recall failure on this packet.

The v3 semantic experiment ranks deduplicated literal parents from the union of the existing 20-per-method BM25+BGE candidates. Its title-plus-question pair input preserves the pronoun question. It supplies source label, original CQA question and unchanged body to the cross-encoder. The three torch reports rank 16, 5 and 10, with logits below the fixed selection floor. The result delivers **0/3**. Ranking every source for this product also delivers **0/3**, so broadening recall alone does not rescue this experiment. Two other cases receive empty semantic contexts; every miss and all twelve cases remain saved. These results were not used to retune the model, thresholds or query wording.

The separately versioned `workspace-source-coverage-v3-facets-dev` heuristic fixes the reported facet-crowding defect by prioritizing uncovered requested intents, accounting for facets already in baseline. Its synthetic regression recovers capacity after a combined color/material parent. It is an engineering fix, not empirical answer improvement. It is not the semantic arm, and neither v3 candidate is activated in the application.

## Contracts and limits

`ProductRetriever.diagnose()` adds genuine FTS5 raw BM25 scores/top-20, full per-product dense cosine scores, the scope-promoted candidate lists, RRF input ranks/scores, final fusion order and each chunk's selection/skip reason. Existing `retrieve()` and `compareRankings()` selections are retained. BM25 is lower-is-better; cosine and fusion are higher-is-better. Final scope promotion is explicit and separate from the RRF score. Raw BM25 below rank 20 is **unobserved**, not an invented rank. The saved twelve selections equal the historical baseline exactly.

`diagnoseUsefulSources()` records chunk-to-parent restoration and parent deduplication, literal source hashes and original question, supplemental reasons and designated-fact delivery. Heuristic parents have null BM25/dense ranks; semantic logit/rank records live in a separate ranking array. Identifier matches and high relevance scores do not establish part compatibility. No literal source, model punctuation, conditions or CQA scope is rewritten.

The experimental semantic selector uses at most eight parents/12,000 body characters, each at most 1,500 characters. It scores at most 128 deduplicated parents. Fixed relevance band: logit at least max(-5, best-8); MMR subtracts three times maximum token Jaccard similarity. Same-scope bodies with similarity >.85 are suppressed. This limits repetition; it does not guarantee semantic facet completeness. Different original questions remain distinct. These arbitrary development settings require independent evaluation before production use.

The locally runnable model is [Xenova's ONNX MiniLM cross-encoder](https://huggingface.co/Xenova/ms-marco-MiniLM-L-6-v2), revision `a09144355adeed5f58c8ed011d209bf8ee5a1fec`, q8 CPU, using the existing Transformers.js 4.3.0 dependency. Its [upstream model](https://huggingface.co/cross-encoder/ms-marco-MiniLM-L6-v2) declares Apache-2.0. Exact ONNX/tokenizer/config SHA-256s are pinned in `server/semantic-reranker.ts`. Config permits 512 tokens per query/document pair; tokenization includes pair special tokens. Overlength pairs fail without truncation. Runtime reads only verified cached assets and never downloads or uses hosted reranking. The [Sentence Transformers retrieve/rerank documentation](https://sbert.net/examples/sentence_transformer/applications/retrieve_rerank/README.html) supports this two-stage architecture; its benchmark claims are not Ablatrix results.

The final local CPU trial scored 204 hybrid-pool pairs in 1,272.2 ms total and all 217 parents in 1,232.3 ms total. Median case scoring times were 104.6/96.3 ms; torch hybrid scoring took 109.7 ms. Peak process RSS reached 537,034,752 bytes (~512 MiB). These are single local observations, including model load on the first hybrid case, with BGE and reranker sharing a process; subsequent calls are warm. They exclude answer generation and are not a latency benchmark or provider-cost estimate. Per-case CPU, wall time, RSS and runtime architecture are saved.

## Three contexts and evaluation

`prepareThreeContext()` verifies literal context membership, original scope and designated reference facts, and builds identical generation bodies for current/semantic/reference arms except context, derived citation options and operation identity. All arms use the same existing route, v1 instructions, shared policy, 1,500-character answer budget, citation schema and question. References are diagnostic sources, not a production retrieval option or an assurance that all questions are answerable.

The saved torch reference is the union of the three independently source-reviewed duration parents. It preserves disagreement, missing conditions and manual extinguishing; it supports attributed observations, **not** a population average. Reference sufficiency is AI source-checked, not human-certified. No generation or judging occurred. The actual prepared packet contains three request bodies but `paidPlan: null`: no designated missing fact reaches the semantic arm. All answer arms are unattempted.

`executeThreeContext()` is a bounded dependency-injected execution adapter with exact financial approval/opt-in before provider construction, durable reservation and intent checkpoints before dispatch, exact endpoint/body matching, no retry, model consistency, receipt replay/recovery and preserved unattempted arms. It checks code/artifact hash maps and the canonical ledger's historical anchor, reservations, pending rows and owner on each operation. The caller must supply exclusive durable output creation, actual byte-reading binding checks and the existing ledger/provider; there is intentionally no credential-reading live CLI for this failed candidate. Recovery is read-only and cannot redispatch. Unknown intent totals are null, with observed dispatches and unresolved intents separately retained. The existing v2 adapter now reports this distinction too.

`anonymousDiagnosticReview()` emits complete sources, reference qualifications, anonymous answer labels, failed/unattempted arms and a separate concealed-arm mapping. Keep the mapping private until judgments are saved. The rubric in `server/answer-diagnostic-evaluation.ts` separates useful fact completeness, unsupported claims, exact applicability, uncertainty, direct relevance and mechanical literal citation membership. Review each fact and preserve rationale/source IDs. AI judgments must be labeled provisional. `calibratedAIReview()` binds a small human source-checked reference set to answer/source hashes and exposes per-axis disagreements for focused human review. There are **zero real human calibration judgments**; fictional tests do not fill that gap. No AI agreement, script pass or source delivery establishes answer correctness. AGENTS.md still requires source-checked human reviews and a gain on fresh product-disjoint cases for final quality claims/promotion.

## Reproduce

After `npm ci`, one offline command verifies the original v2 producer/deck in an isolated tree and replays its failed comparison, then checks the new saved stage/source diagnostics and the three-context stop:

```sh
npm run diagnosis:replay
```

This needs the ordinary Git history containing `71e21e4` and no ignored `work/`, credentials, ledger or model cache. A shallow checkout must fetch that commit first. The public input bundle preserves exact raw producer/history bytes at their original paths. Frozen code is read from that commit, not silently changed to accept the new code. Local producer records do not independently authenticate upstream dataset membership. `source-packet-disjointness.py` adds the missing cross-case packet guard for the next protocol; its saved audit found no duplicates in the historical twelve-product deck, which remains unchanged. Future preparation must run this guard against **all** protected and selected packets before accepting a new deck; any overlap stops the packet, without replacing cases.

One mocked workflow uses the real existing provider's temporary SQLite reservations, mocked transport, exact receipts and anonymous output:

```sh
npm run diagnosis:mock
```

To explicitly prepare public model assets (network download, no inference API), then recompute scores locally:

```sh
node --import tsx scripts/prepare-semantic-model.ts
npm run diagnosis:run -- /private/tmp/ablatrix-new-diagnosis.json
```

The diagnosis command blocks network, uses only cached models and refuses output overwrite. Saved score replay checks source/rank arithmetic and delivery without recomputing logits; the latter command is the model recomputation. Offline three-context preparation uses the existing canonical ledger read-only:

```sh
node --import tsx scripts/prepare-three-context.ts docs/evidence/retrieval-diagnosis-2026-10-19/stage-traces-v3-final.json /private/tmp/ablatrix-new-three-context.json
```

The ledger was re-read at 138 attempts, $13.80 reserved + $0.200281 prior adjustment = $14.000281 local planning usage, zero pending/owners under the unchanged $20 cap. These are local allowances, not settled charges or a provider-enforced cap. **No paid proposal qualifies; proposed authorized new calls: zero.** Prior approvals are not reused.

## Next prospective protocol (inactive)

Stop this candidate at development. Before selecting any new questions, a revised candidate must demonstrate a useful source-delivery reason to continue, receive code/source review and freeze its implementation, model artifacts, preprocessing, selection and analysis. Protect every historical/exposed product, title/family/model and normalized body-plus-original-question fingerprint, including all twelve failed-deck products and all 44 earlier development products. Reject within-deck overlap before preparation. Keep misses, uncertainties, controls and unattempted arms in the denominator; no reseeding or replacing failures.

A feasible later diagnostic would retain a fixed small packet (at most eight product/family/source-disjoint questions, three contexts each), prewrite source-only useful-fact/qualification references before seeing model outputs, rotate arm order, and freeze identical answer contracts. Independently review source applicability and sufficient reference context. AI reviewers first require calibration against a small source-checked human reference set; focus further human review on disagreements/material regressions. A new exact plan must enumerate every call, zero retries/web/grader calls unless separately authorized, all code/source hashes, refreshed canonical ledger totals and cumulative allowance before approval. This is a protocol draft, not a paid plan or authority to select fresh questions now.

## Verification

630 server tests passed, one platform skip; 64 Python tests passed; production build and strict standalone script types passed. Focused tests cover stage loss/product isolation, literal model scope, pronouns, facet crowding, cache failure, conflicting reference sources, contract equality, tampering, zero-benefit stop, uncertain dispatches, model drift, invalid citations, duplicate dispatch, receipt recovery and provisional AI calibration. Full-suite localhost tests require running outside restricted sandbox networking. No model/provider credentials or .env files were read.

Evidence: [final traces](evidence/retrieval-diagnosis-2026-10-19/stage-traces-v3-final.json), [three-context stop/preparation](evidence/retrieval-diagnosis-2026-10-19/three-context-preparation-final.json), [public frozen inputs](evidence/retrieval-diagnosis-2026-10-19/frozen-v2-public-inputs-v1.json), [historical packet audit](evidence/retrieval-diagnosis-2026-10-19/v2-packet-overlap-audit.json). The first local trace/preparation files remain as exploratory run records; the `final` files contain final implementation bindings. Historical failed studies and the prior 16-answer results are preserved.
