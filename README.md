# Ablatrix

A local-first performance lab for one built-in, citation-bearing company/product research agent. It stores runs, evaluates a curated task suite, queues bounded experiments, and compares a candidate configuration with its baseline. See [the six-PR ledger](docs/build-plan.md) for release evidence.

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
