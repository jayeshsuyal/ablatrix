# Automatic RAG and harness checks

Routine reliability checks run without manual judgments. One offline command exercises production retrieval, citation resolution, revision execution and durable receipts against fictional source contracts. It makes zero paid calls and uses isolated SQLite storage.

```sh
npm ci
npm run check:reliability -- --out /tmp/ablatrix-reliability.json
```

The output must be a new file. The command exits nonzero for a failed or inconclusive suite and preserves expected and observed checkpoint values. CI runs the same command and uploads the `offline-reliability` JSON artifact. No application state, historical generated answers, fresh comparison cohort or held-out answer labels are used.

## What the gate checks

| Layer | Observable contract |
| --- | --- |
| RAG scope | The explicitly named model's source survives crowded, identically worded customer answers, including a target beyond the first 20 candidates. |
| RAG boundaries | Scope priority requires the full extracted identifier set to agree. Short, numeric and explicitly listed IDs use the same rules in queries and parent questions; partial lists receive no boost. Unscoped questions retain their prior ordering. |
| Source context | Product isolation, full source text, separate parent questions, conflicting variants and numeric records survive retrieval and citation resolution. |
| Context budget | Selection remains within five sources and 6,000 characters, counting parent-question metadata. |
| Invalid output | An out-of-context citation produces no accepted revision or extra generation. |
| Uncertain transport | The durable uncertain receipt survives reopening; the worker does not dispatch it again. |
| Missing information | Unsupported compatibility stops investigation before generation, with no receipt or transport attempt. |
| Exhausted allowance | The worker leaves the job queued and makes no transport attempt. |

Fixtures explicitly identify required source IDs. Source coverage counts are regression assertions about these fictional inputs. Numeric checks establish byte preservation; they do not decide which axis, unit, variant or conflicting value is the correct answer.

### Two embedding modes

The default `injected_contract` uses constant deterministic vectors. This deliberately stresses tie ordering and selection mechanics; it measures no semantic embedding performance.

To exercise the actual revision-pinned CPU BGE runtime, first cache its public assets using `npm run feedback:prepare`, then run:

```sh
npm run check:reliability -- --out /tmp/ablatrix-reliability-bge.json \
  --embedding pinned_local_bge
```

The check itself denies network access. Missing cached assets produce `inconclusive` and a nonzero exit; there is no fallback embedding. The two modes remain separately labeled. Each report records fixture hashes, model identity and hashes of the exercised source files.

## Retrieval repair

Before this repair, the retriever indexed customer-answer bodies and preserved their parent questions, but did not use those questions to select sources. With eight or 25 identical answers, the requested model's source fell outside the selected top five. Both failures were reproduced using constant injected embeddings.

Selection now gives complete identifier-set agreement between the query and parent question a ranking priority before candidate truncation. Both sides use the same extraction rules, including bounded labeled lists; ordinary measurements and ordinals remain excluded. Missing or extra identifiers receive no priority. This preserves answer-only lexical and embedding input, source bytes, variant conflicts and the existing context limits. Priority does not remove every mismatched source or establish a fit relationship or factual support.

Report fields named `bm25`, `dense` and `hybrid` describe scope-aware rankings. They include the identifier priority and must not be compared as pure, unchanged method baselines against older audits.

## Saved results

| Run | Retrieval contracts | Harness contracts |
| --- | --- | --- |
| [Prior retriever, injected vectors](evidence/automated-contracts-2026-10-12/before-injected-v3.json) | 3/10 required fixture sources retrieved; seven scenarios fail. | Not run in this baseline replay. |
| [Current retriever, injected vectors](evidence/automated-contracts-2026-10-12/injected-v3.json) | 10/10 required fixture sources; 11/11 scenarios and 85/85 checkpoints pass. | 4/4 scenarios and 64/64 checkpoints pass. |
| [Current retriever, cached pinned BGE](evidence/automated-contracts-2026-10-12/pinned-bge-v3.json) | 10/10 required fixture sources; 11/11 scenarios and 74/74 checkpoints pass. | 4/4 scenarios and 64/64 checkpoints pass. |

The prior replay used the same fictional fixtures, required IDs, constant vectors and citation resolver with the exact committed retriever from `8f0938cb77cac7e356fa66d82b23ac63ab6f732b`, loaded in an isolated temporary module tree. It checks the discovered failure and its repair; it is not a fresh model-quality experiment. The BGE run has fewer checkpoints because the injected-embedding input spy is unavailable in real-model mode. Both current harness runs observe two scripted transport attempts and zero paid calls.

The [initial eight-case qualification](evidence/automated-contracts-2026-10-12/injected.json), its [BGE run](evidence/automated-contracts-2026-10-12/pinned-bge.json) and [prior replay](evidence/automated-contracts-2026-10-12/before-injected.json) remain unchanged. The first bot review found that the four-character heuristic excluded explicitly labeled short models. Version 2 exempted labeled IDs and added the H5 case; its [nine-case injected report](evidence/automated-contracts-2026-10-12/injected-v2.json), [BGE report](evidence/automated-contracts-2026-10-12/pinned-bge-v2.json) and [prior replay](evidence/automated-contracts-2026-10-12/before-injected-v2.json) are also preserved.

The next review exposed two gaps: a long numeric target was recognized in a parent question but omitted from the query, and plural model labels could lose short identifiers. Independent review also checked numeric and measurement-shaped IDs inside explicit lists. Version 3 uses symmetric extraction and bounded label propagation, and requires the complete identifier sets to agree. Two added scenarios stress partial part/model matches and mixed explicit lists. Its baseline uses the same 11 fictional cases; these are component regression checks, not a whole-product quality evaluation.

Verification: 318 server tests pass, one Linux-only test is skipped locally, the production build and strict CLI typecheck pass, and all 101 protected historical and version 1/2 evidence-file hashes remain unchanged. The shared live ledger remains at 86 attempts with no pending reservation. CI also runs the existing Python selector and browser suites.

## What a pass means

The report separates `mechanical: pass|fail|inconclusive` from `semanticAssessment: not_run`, with `qualityClaimEligible: false`. Exact citation provenance, answer correctness and user preference remain distinct. A model judge can later estimate claim support and adequacy; its output must retain AI provenance and uncertainty rather than becoming a factual label by default.

This follows the practical distinction between reproducible code checks and more flexible, nondeterministic model grading described in [Anthropic's agent evaluation guide](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents). These checks provide an automatic regression gate, with narrow, inspectable guarantees.

The harness section exercises the current workspace's legacy passage-and-quote revision contract. `source_ids_v3` remains an explicit comparison interface; this command does not enable it across the product or establish live Router reliability.

Historical experiment bytes remain unchanged. The unexecuted October 11 paid plan binds the earlier retrieval code, so its verification rejects this revision. Future paid execution needs a newly qualified plan and approval; this gate creates neither a live result nor a promotion.
