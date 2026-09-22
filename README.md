# Ablatrix

A local-first performance lab for one built-in, citation-bearing company/product research agent. The current baseline slice records each run and shows its answer, sources, timing, and cost status in a connected UI. Optimization and evaluation are planned in [the six-PR ledger](docs/build-plan.md).

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

## Live Sapiom path

The research definition lives in `sapiom-agent/index.ts`. It uses Sapiom `search.webSearch` and `search.scrape` inside a deployed agent run. Deploy that definition through Sapiom Agent Studio or MCP. After configuring an enforceable spending rule in Sapiom, set `ABLATRIX_MODE=live`, `SAPIOM_AGENT_SLUG`, `SAPIOM_API_KEY`, `ABLATRIX_SPEND_CAP_USD`, and `SAPIOM_BUDGET_ENFORCED=1` for the server. The backend calls the deployed agent through the official `@sapiom/tools` `agents.run` SDK. The code has not been deployed or exercised with paid capabilities. The local cap is an authorization gate in this baseline slice; Sapiom must enforce actual spend. Live cost remains **unknown** until usage/prices can be verified. The synthesized answer is shown alongside source excerpts; it is not yet claim-by-claim verified.

Sapiom search and agent SDK contracts were checked against the installed pinned package types and [official search documentation](https://docs.sapiom.ai/capabilities/search). Sapiom's [call-surface guide](https://docs.sapiom.ai/guides/choose-a-call-surface) describes deployed agent runs.
