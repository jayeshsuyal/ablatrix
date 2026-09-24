# Search ablation pilot

The first standalone **live** 32-call batch and its measured results are in [pilot-live-results-2026-09-24.md](pilot-live-results-2026-09-24.md). The `/pilot` app's production provider remains gated; the live batch used a separate exploratory harness after the user waived the remote-ceiling condition for that batch.

Open `/pilot` after `npm run local`. Select **Run local demo** to exercise the 32-call synthetic rehearsal. `npm run pilot` runs the same rehearsal from the terminal and saves a JSON evidence bundle under `outputs/`. The dedicated state database is `.data/search-pilot.sqlite` (`ABLATRIX_PILOT_DB` overrides it). The CLI and web server must not own this database at the same time.

## Frozen question and protocol

Does adding a web-search hypothesis help answer a documentation question when the supporting official source excerpt is already supplied? The two arms use the same requested model alias (`gpt-luna`), lane (`run_now`), 4,096-token output ceiling, prompt template, output schema, and frozen official source text. Baseline performs one search and one answer call. Candidate performs one answer call with an empty search hypothesis. Search response text is bounded and treated as untrusted context; every answer citation must quote the frozen official excerpt exactly.

The preregistered primary target is at least 20% median paired reduction in answer-stage elapsed time, with all 16 answers per arm judged supported and correct and no candidate regression. This is a descriptive eight-question pilot. It does not establish population accuracy, general research ability, a statistical confidence claim, or a guaranteed saving. Dollar charges are reported separately; a speed improvement alone is not a cost-saving claim.

Source acquisition is shared preparation, excluded from both arms' time and cost. The excerpts contain nearby documentation context but were selected to contain the answer. The experiment measures whether an extra search helps once adequate evidence is in hand. It does not measure discovery or retrieval. See `data/pilot/README.md` for source capture and attribution.

## Execution and review

- Four development questions are available for preflight. Eight different questions from disjoint documentation pages form the frozen evaluation set. Preflight must succeed on development questions before paid evaluation is enabled by a real provider.
- Two repetitions of each evaluation question produce 16 pairs / 32 invocations. Repetitions are explicit; they are not retries or additional independent questions.
- The saved seed determines question order and which arm runs first in each adjacent pair. The model inputs omit expected answers and reference facts.
- The dedicated runner makes one attempt per slot. Priced answer failures remain in the result and later pairs continue. Unknown charges, timeouts, changed spending contracts, or over-bound charges stop subsequent live calls. Cancellation lets the active call settle and stops the next slot. Restart preserves the interrupted run without automatic replay.
- Review cards shuffle anonymous answers without arm, repetition, timing, or model identity. A human marks correctness, quote support, and whether the reference answer agrees with the excerpt. Reviews are frozen once submitted. Paired quality results and exports stay hidden until all successful answers are reviewed. Failure is never a correct answer.
- The fixture provider replays reference answers and synthetic reviews without any model call. All fixture verdicts are inconclusive and latency, dollar charges, and token counts remain unavailable.

Each export stores the complete frozen suite, source checksums, seed and schedule, requested controls, per-call outcomes, usage and charge references when present, human/synthetic review provenance, and a before/after search configuration. This lets a reviewer examine a result without relying on changing web pages.

## Named model workflow and live boundary

`server/pilot-workflow.ts` implements the actual search/answer sequence using injected search and Router transports. `createNamedRouterTransport` uses the documented `https://router.sapiom.ai/v1/chat/completions` endpoint and requests `gpt-luna` with `reasoning_effort: none` to support the structured function tool. It verifies the returned alias and forces a structured tool response. The named alias is not a pinned provider model revision. Tests inject both transports and make no network requests.

The generic `ctx.sapiom.llm.run` used by the older research agent only selects a routing label, so it cannot establish the pilot's named-model control. A future Sapiom integration must run capability search inside a deployed agent and connect the named-model Router transport through a supported credential surface. Local Sapiom stubs do not intercept raw fetch.

Production `SapiomPilotProvider` is deliberately unavailable. The injected metered provider must provide a verified hard spending contract covering prior work and all in-flight calls, a maximum whole-call charge before dispatch, and settled whole-call charge afterward, including search, model, runtime, failure, and retry charges. The ledger uses integer micro-USD, reserves before dispatch, accounts for prior spend, and refuses a batch whose 32 worst-case calls do not fit the approved cap (at most $10). An environment flag cannot establish these contracts.

Read-only investigation on 2026-09-24 reconfirmed that the [execution audit is cost-agnostic](https://docs.sapiom.ai/guides/inspect/), the [Router supports named aliases](https://docs.sapiom.ai/router/), and the current [agent authoring contract](https://api.sapiom.ai/v1/agents/authoring-rules) treats `llm.run` model values as routing labels. An authenticated read of prior run `729568` still returned `cost: null`. No supported API for the required $10 enforcement and whole-call settlement contract was verified. No new paid call was made for this implementation.
