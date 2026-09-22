# Ablatrix

A local-first performance lab for one built-in, citation-bearing company/product research agent. It stores runs, evaluates a curated task suite, queues bounded experiments, and compares a candidate configuration with its baseline. See [the six-PR ledger](docs/build-plan.md) for release evidence.

## Run locally

Requires Node.js 24.10 or later. Copy `.env.example` to `.env` if you want to change defaults; the server does not load `.env` automatically, so export settings in your shell or use an env loader.

```sh
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:4173`. Fixture mode is the default and does not call Sapiom or prove research quality. The SQLite database is stored at `.data/ablatrix.sqlite`. `npm test` runs the API and persistence check.

For UI development, run `npm run dev` for the backend and `npx vite --host 127.0.0.1` for the frontend on port 5173.

## Evaluation data

`data/tasks.v1.json` contains three manually checked, source-linked examples from [GitHub](https://github.com/about), [Cloudflare](https://www.cloudflare.com/products/workers/), and [Mozilla](https://www.mozilla.org/en-US/products/). They are split by entity and source into development, validation, and a sealed holdout. The public task API omits expected facts and the holdout task itself. The deterministic rubric checks required answer terms, an approved source host, and that cited URLs resolve to returned sources. This is a limited proxy for correctness, not a full semantic verification. The report excludes fixtures from live quality and cost statistics and states its sample size.

## Experiments

The experiment runner stores jobs and steps in SQLite. It accepts only curated development/validation task IDs, runs serially, caps tasks, attempts and duration, supports cancellation before the next task, and resumes interrupted fixture jobs on startup without treating unfinished attempts as successes. Interrupted live jobs halt the live queue for inspection to avoid repeating an unknown paid call. Live experiments require a positive local cap within the approved amount **and** an upstream Sapiom spending rule; because per-run costs are not yet available, they stop after the first unknown-priced attempt. A call that exceeds the local deadline is marked interrupted; Sapiom may continue processing and billing it. Cancellation stops future tasks but cannot abort a Sapiom call already underway. Direct live baseline submissions are disabled until metering is available. The UI shows progress and errors from the persisted job record.

## Bounded optimization

The optimizer investigates development results, proposes one allowlisted configuration change, runs the same development and validation tasks through the persistent runner, and challenges each task against its baseline. Supported settings cover Sapiom model routing (`search-native` or `small`), prompt pruning, a ten-minute cache capped by each task's freshness window, and parallel reads of two checked source URLs. The challenger rejects a regression on any baseline-correct task and only accepts lower **priced** cost per correct task. Fixture or unpriced results produce an explicit no-improvement outcome. Candidate and baseline runs retain their settings, citations, provider, and task IDs. Live optimization is blocked pending unified accounting for Sapiom Router proposal calls and experiment spend; the Router adapter is present but does not run without that gate. No holdout answer is available to proposal selection.

## Comparison and export

The dashboard compares the latest optimization's paired tasks, including failed attempts, elapsed time, source links, quality checks, and priced costs when available. It shows experiment cost and break-even as unknown until all required metering exists. Downloads include the original and candidate configurations, a patch for `configs/research.json`, and a reproducibility manifest with suite version, checksum, task/run IDs, and source URLs. The manifest lists required environment variable names but contains no credentials. Fixture comparisons are demonstrations, not evidence of a live gain.

## Live Sapiom path

The research definition lives in `sapiom-agent/index.ts`. It uses Sapiom `search.webSearch` and `search.scrape` inside a deployed agent run. The scrape URL comes from the curated task's checked source, never from the search results or browser input. Deploy that definition through Sapiom Agent Studio or MCP. After configuring an enforceable spending rule in Sapiom, set `ABLATRIX_MODE=live`, `SAPIOM_AGENT_SLUG`, `SAPIOM_API_KEY`, `ABLATRIX_SPEND_CAP_USD`, and `SAPIOM_BUDGET_ENFORCED=1` for the server. The backend calls the deployed agent through the official `@sapiom/tools` `agents.run` SDK. The code has not been deployed or exercised with paid capabilities. Sapiom must enforce actual spend. Live cost remains **unknown** until usage/prices can be verified. The synthesized answer is shown alongside source excerpts; it is not yet claim-by-claim verified.

Sapiom search and agent SDK contracts were checked against the installed pinned package types and [official search documentation](https://docs.sapiom.ai/capabilities/search). Sapiom's [call-surface guide](https://docs.sapiom.ai/guides/choose-a-call-surface) describes deployed agent runs.
