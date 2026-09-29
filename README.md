# Ablatrix

Ablatrix is a local product QA workspace with an evidence-based agent evaluation lab. Its current prototype answers from product sources and turns reviewed failures into versioned answer-policy candidates, comparing each candidate with its parent before promotion or rejection. See [the build ledger](docs/build-plan.md) for implementation evidence and the earlier research experiments.

## Product QA workspace

Open `/ask` to add a product and paste up to eight source excerpts, then ask a question. **Preview evidence** uses local hybrid retrieval and makes no model call. **Generate cited answer** is available only when the local Sapiom Router opt-in and shared planning allowance are configured. Answers, citations, retrieved evidence, and failed attempts are saved in `.data/product-workspace.sqlite`; the retrieval index is stored beside that database with a `.retrieval.sqlite` suffix. Imported products are isolated from the frozen evaluation corpora. Exact-quote checks verify citation membership, while answer correctness still needs human judgment. This is a local workflow, not a deployed multi-user service or a measured answer-quality gain.

A [fixed 20-product paid smoke batch](docs/evidence/paid-qa-batch-2026-09-28/report.md) completed all 20 calls and verified 52/52 exact citation quotes. It measures execution and provenance; answer correctness has not been independently human reviewed.

## Product QA feedback loop — v0.2

Open `/loop` for the saved live experiment when one exists; choose Synthetic demo to exercise **batch answers → review → propose → blind paired validation → promote/reject → final comparison**. SQLite stores the evidence, feedback, policy lineage, runs, and decisions. Rollback restores an earlier version.

- **Evidence:** 304 genuine Amazon ePQA passages across 10 development and six separate validation products, plus 498 passages from 20 unseen final products. The final set has no supplied answer labels. Original annotations and AI-assisted development guidance require independent human review.
- **Retrieval:** product-filtered BM25 + local BGE semantic embeddings, combined with reciprocal rank fusion. Retrieval, corpus, and model stay fixed while the answer policy changes.
- **Live model:** Sapiom `gpt-luna`, with structured output, exact-quote provenance checks, bounded requests, and a durable local planning allowance.
- **Feedback:** a reviewed development failure is required to propose an update. Each live validation answer needs a human correctness/support review with at least one checked product source. Promotion requires a strict gain on fresh validation products and no observed paired regression; development controls only check regressions. Rollback restores a previous version.
- **Comparison:** one frozen batch per policy version, randomized anonymous A/B review cards, and a 20-product final report with paired outcomes, regressions, uncertainty, latency, tokens, and explicit unknown billed cost. Live final execution requires a full 40-call local preflight.
- **Demonstration:** the synthetic mode exercises the full workflow. Its scripted scores are clearly labeled and do not establish model improvement.

Prepare the pinned local embedding model before starting:

```sh
npm ci
npm run feedback:prepare
npm run feedback:prepare -- --final
npm run feedback:retrieval-audit
npm run local
```

Then open `http://127.0.0.1:4173/loop`. Preparation downloads public weights once and makes no Sapiom calls. See [setup and live configuration](docs/feedback-loop-local.md), [corpus provenance](docs/product-corpus.md), and [the frozen v0.2 protocol](docs/feedback-loop-v0.2-protocol.md). The final runner is implemented; a human-reviewed live feedback gain has not yet been measured.

The [paid product QA batch](docs/evidence/paid-qa-batch-2026-09-28/report.md) has a source-check review queue at `http://127.0.0.1:4173/paid-review`. It displays the 20 pinned saved answers, full supplied source text, and [20 AI-only review suggestions](docs/evidence/paid-qa-batch-2026-09-28/ai-review-notes.md). Suggestions may prefill a form but leave source checks, reviewer identity, and confirmation empty. The page saves explicit human judgments separately in `.data/paid-answer-review.sqlite` (override with `ABLATRIX_PAID_REVIEW_DB`); review data can be exported. Opening and reviewing this packet makes no Sapiom calls. The batch is a curated train-split sample; AI drafts and human scores are not a population accuracy estimate or a comparison against a candidate.

The sections below describe the earlier `/pilot` and research workspaces, which retain their own execution and accounting rules.

## Focused search experiment

Open `/pilot` for the focused GitHub Actions experiment: compare the same requested answer model and frozen official excerpt with and without an extra web search. Twelve contextual documentation examples provide four development questions and eight evaluation questions; two paired repetitions yield 32 measured slots. The local demo exercises persistence, anonymous answer review, comparison, and export using clearly labeled synthetic answers. `npm run pilot` writes the same rehearsal as an evidence bundle. The real search/Router workflow is implemented with injectable transports; paid dispatch remains blocked until Sapiom's spending, settlement, and model preflight evidence are available. See [the frozen protocol and limits](docs/search-ablation.md).

## Run locally

Requires Node.js 24.10 or later. From a clone, run:

```sh
./start.sh
```

Open `http://127.0.0.1:4173`. The script installs locked dependencies if needed, builds, and starts the local server. Copy `.env.example` to `.env` to change defaults; `npm start` loads it automatically. Fixture mode is the default and does not call Sapiom or prove research quality. The SQLite database is stored at `.data/ablatrix.sqlite`. `npm test` runs API and persistence checks; `npm run test:e2e` runs browser tests after `npx playwright install chromium`.

For UI development, run `npm run dev` for the backend and `npx vite --host 127.0.0.1` for the frontend on port 5173.

## Evaluation data

`data/tasks.v2.json` contains six model-drafted, source-grounded pilot examples from [GitHub](https://github.com/about), [Cloudflare](https://www.cloudflare.com/products/workers/), and [Mozilla](https://www.mozilla.org/en-US/products/). These labels have not had independent human review. The suite is split by entity and source into two development, two validation, and two sealed holdout tasks. The public task API omits expected facts and holdout prompts. The deterministic rubric checks required answer terms, an approved source host, and that cited URLs resolve to returned sources. This is a limited proxy for correctness, not a full semantic verification. The report excludes fixtures from live quality and cost statistics and states its sample size. After a frozen optimization, use the UI's final fixture holdout action or `npm run holdout -- <optimization-id>` for a one-time paired baseline/candidate synthetic assessment; an interrupted assessment can resume, while paid holdout execution remains blocked.

## Experiments

The experiment runner stores jobs and steps in SQLite. It accepts only curated development/validation task IDs, runs serially, caps tasks, attempts and duration, supports cancellation before the next task, and resumes interrupted fixture jobs on startup without treating unfinished attempts as successes. A shared SQLite budget ledger reserves capacity for proposal and research calls, settles evidence idempotently, and holds unknown calls after a timeout or restart. The real Sapiom provider cannot dispatch until whole-call charges and the remote cap are verifiable. Cancellation stops future tasks but cannot abort a remote call already underway. Direct live baseline submissions remain disabled. The UI shows persisted progress and the live readiness reason.

## Bounded optimization

The optimizer investigates development results, proposes one allowlisted configuration change, runs the same development and validation tasks through the persistent runner, and challenges each task against its baseline. Supported settings cover Sapiom model routing (`search-native` or `small`), prompt pruning, a ten-minute cache capped by each task's freshness window, and parallel reads of two checked source URLs. The challenger rejects a regression on any baseline-correct task and only accepts lower **priced** cost per correct task. Fixture or unpriced results produce an explicit no-improvement outcome. A fake metered provider verifies the full live code path without paid calls. The real Sapiom provider remains blocked pending charge and cap contracts. No validation or holdout answer is available to proposal selection.

## Comparison and export

The dashboard compares the latest optimization's paired tasks, including failed attempts, elapsed time, source links, quality checks, and priced costs when available. It shows total experiment cost and break-even only when all research and proposal charges are settled. Downloads include the original and candidate configurations, a patch for `configs/research.json`, and a reproducibility manifest with suite version, checksum, task/run IDs, and source URLs. The manifest lists required environment variable names but contains no credentials. Save a candidate JSON download and run `npm run replay -- /path/to/research.candidate.json` to verify a synthetic fixture replay with that exact configuration. Fixture comparisons are not evidence of a live gain.

## Live Sapiom path

The research definition lives in `sapiom-agent/index.ts`, with its own pinned package and TypeScript configuration for reproducible Sapiom checks and deployment. It scrapes only curated checked URLs. The `search-native` setting also obtains a search hypothesis, but both settings draft the answer from checked excerpts and require an exact supporting quote from a returned source. Quote presence is a provenance check, not semantic proof that the answer is correct. The existing SDK adapter can call a deployed agent, but the application does not invoke it because its result lacks priced usage. Environment flags alone do not unlock paid calls. See [the accounting boundary](docs/sapiom-accounting.md) for the exact missing provider contracts. A short standalone Router connectivity pilot completed. Production runs `728875`, `729073`, `729546`, and `729568` failed; their Run Inspector charges total $0.06. Run `729546` hit the routed model's 1,024-token limit before emitting JSON. Run `729568` ended within a 4,096-token limit but returned text that was not JSON. The local source now requests a structured output tool with the larger budget and accepts fenced JSON as fallback; this revision has not been deployed or live-validated. No successful live research or measured optimization claim exists yet.

Sapiom search and agent SDK contracts were checked against the installed pinned package types and [official search documentation](https://docs.sapiom.ai/capabilities/search). Sapiom's [call-surface guide](https://docs.sapiom.ai/guides/choose-a-call-surface) describes deployed agent runs.

See [architecture and tradeoffs](docs/architecture.md) and [release evidence](docs/release-evidence.md) for the implemented boundaries, test results, and remaining live validation work.
