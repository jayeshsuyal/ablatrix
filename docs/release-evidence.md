# Release evidence

## Focused search experiment — 2026-09-24

A separate 32-call **live exploratory batch** now provides measured timing and billing-meter results. See [the live report](pilot-live-results-2026-09-24.md). It does not change the gated `/pilot` provider or complete the required independent blind answer review.

- `/pilot` provides the single-change search experiment, responsive comparison, progress/cancellation, persisted reports, anonymous answer review, and evidence export.
- Frozen protocol: same requested `gpt-luna` alias and controls; one search toggle; eight distinct evaluation questions, two repetitions, 32 calls. Four separate questions are reserved for development. Every official excerpt and reference quote has a verified SHA-256/membership check. Labels were checked by an agent and still require human confirmation.
- `server/pilot-workflow.ts` implements the search plus named Router call through injected transports. Request controls, alias checks, truncation and malformed output handling, and exact source quotes are tested without network calls.
- Full verification: **48 tests passed, 6 Chromium browser tests passed, production build passed**. Browser checks include the synthetic pilot/export/reload/mobile path and explicit anonymous-review submission. A separate fake metered provider exercises successful and rejected live-shaped comparisons, charge holds, failures, cancellation, and model-identity changes.
- `npm run pilot` completed all 32 synthetic slots and wrote `outputs/search-ablation-40f22b96-036d-45ad-9312-6fad8f4f98be.json`. Its verdict is **inconclusive**, with no live timing, cost, or quality claim. Source snapshots and the complete schedule are included in the artifact.
- During the initial implementation, no paid calls were made. Read-only Sapiom investigation did not establish the provider-enforced $10 cap or whole-call settlement contract, so `/pilot` production dispatch remains disabled. The later standalone live batch was explicitly authorized under a local $10 stop rule and is reported separately above. See [protocol and live boundary](search-ablation.md).

## Demonstrated locally

- API and persistence tests cover saved runs across database reopen, fixture queue completion/cancellation/recovery, halted live recovery, evaluation split boundaries, optimizer rejection, and export accounting.
- Chromium browser tests cover fixture baseline → experiment → optimizer → export → reload; provider failure display; hidden-task rejection; mobile run history; and cancellation with persisted state after reload.
- Security checks cover loopback Host and same-origin mutation boundaries, JSON-only mutation bodies, request size, hidden task output, and direct live-run rejection.
- The production build and dependency audit pass with pinned package versions. GitHub Actions runs tests, build, Chromium E2E, and audit on PRs and merged main.
- `./start.sh` installs from the lockfile if needed, builds, and serves on loopback.

## Observed fixture result

The fixture workflow completes and the optimizer reports **no improvement**. The quality dashboard excludes fixture runs from live sample size and cost per correct task. These observations establish UI and persistence behavior only.

## Pending live acceptance

A short standalone Sapiom Router connectivity request completed with a 148-token usage report; its individual dollar charge remains unknown. The original Ablatrix research agent deployed as ready builds `2217` through `2220` under definition `872`. Production execution `728875` failed after three attempts because `llm.structuredOf` returned no answer object; its Run Inspector charge was $0.03. Execution `729073` failed after one attempt because neither a structured tool result nor usable JSON text was returned; its charge was $0.01. Execution `729546` failed after one attempt because the routed model reached the 1,024-token limit before emitting JSON; its charge was $0.01. Execution `729568` failed after one attempt with `stop=end_turn` and non-JSON text despite a 4,096-token limit; its charge was $0.01. Billing showed no payment method and disabled auto top-up; no enforceable $10 project spending rule was visible. The branch now requests a structured output tool with the larger budget, accepts fenced JSON as fallback, validates the answer and source quote, and emits bounded response-shape diagnostics when parsing fails. This local revision passed typecheck, graph check, and a fully stubbed structured-output run; it has not been deployed or production-tested. The original research agent has no successful production result; the separate pilot's live timing and meter observations still need independent blind answer review and per-call settlement before they become an accepted product claim. The app's live provider remains gated.

The corrective follow-up adds a fake metered provider test path and shared SQLite reservations. It does not unlock the real provider: see [the accounting boundary](sapiom-accounting.md). Passing injected-provider tests proves the orchestration and accounting assumptions in code, not Sapiom's actual charge or cap behavior.

The pilot suite has six model-drafted source-grounded tasks, including two sealed holdouts. The suite is too small for a general performance claim, and its labels need independent review before any benchmark publication. Fake-provider tests cover successful priced comparison, no improvement, quality regression, malformed/timed-out proposal, unknown research charge, and budget refusal. Browser tests cover blocked live readiness and a one-time synthetic holdout after candidate selection.

The deterministic rubric detects missing required terms, an unapproved source host, and citations absent from returned sources. A negative sentence containing the required terms can still pass; a regression test preserves that known false-positive example. A human semantic review or stronger independent grader is required before treating pilot pass rate as truth.
