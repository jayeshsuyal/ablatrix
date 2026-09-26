# Feedback-loop v0.1 implementation evidence

Local verification on 2026-09-24. This records a working prototype and one live connectivity/grounding smoke test, not a measured learning gain.

## Verified implementation

| Check | Result |
| --- | --- |
| Unit, persistence, provider, and HTTP tests | 69 passed |
| TypeScript and production Vite build | Passed |
| Chromium browser tests | 7 passed, including all six existing regressions |
| New browser flow | Answer → review → proposal → paired validation → promotion → export → reload → rollback |
| Responsive layout | No horizontal overflow at 320px across all four feedback stages |
| Real BGE preparation | All 16 products / 304 passages processed with pinned local embeddings |
| Cached offline retrieval | Passed with network fetches forced to fail |

Browser promotion results use explicitly labeled synthetic answers and grades. Provider tests use injected responses. Neither establishes live answer quality.

## Live answer smoke test

One request was made through the actual `/api/loop/runs` route:

| Field | Observation |
| --- | --- |
| Run ID | `76c21c3d-2d7f-4483-be08-0ccdecdd85cd` |
| Development case | `epqa-train-349` |
| Product | `B00251EVPW` — Canvas Panel 8X10 Pack of 12 |
| Question | “how many are included?” |
| Requested / returned model | `gpt-luna` / `gpt-5.6-luna` |
| Outcome | Completed; answered 12 canvas panels and noted the ambiguous `number_of_items` attribute |
| Citations | Three exact quotes from retrieved passages passed provenance checks |
| Total server duration | 3,241 ms |
| Retrieval duration | 601.66 ms, including local model initialization |
| Tokens | 665 input + 187 output = 852 |
| Planning ledger | One attempted call, $0.10 reserved allowance |
| Actual billed cost | Unknown; the allowance is not a settled charge |

The saved trace is in the local SQLite run history and ignored `work/feedback-live-smoke.json`. The `/api/loop/export` download includes run evidence and policy lineage without credentials. No human review was fabricated, no live proposal was promoted, and no comparative quality margin is reported.

## Remaining experiment

Review development answers against their product evidence; select an actual failure; propose one generic answer-policy change; run and human-review the paired validation. At most three proposal rounds and two new validation products per round are available in this prototype. Its small validation serves as a release check. An independently audited, final held-out evaluation is still required before claiming general improvement or publishing a benchmark result.

See [the local guide](feedback-loop-local.md) for reproduction and [the corpus notes](product-corpus.md) for source and annotation limitations.
