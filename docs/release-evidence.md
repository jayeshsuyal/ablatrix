# Release evidence

## Demonstrated locally

- API and persistence tests cover saved runs across database reopen, fixture queue completion/cancellation/recovery, halted live recovery, evaluation split boundaries, optimizer rejection, and export accounting.
- Chromium browser tests cover fixture baseline → experiment → optimizer → export → reload; provider failure display; hidden-task rejection; mobile run history; and cancellation with persisted state after reload.
- Security checks cover loopback Host and same-origin mutation boundaries, JSON-only mutation bodies, request size, hidden task output, and direct live-run rejection.
- The production build and dependency audit pass with pinned package versions. GitHub Actions runs tests, build, Chromium E2E, and audit on PRs and merged main.
- `./start.sh` installs from the lockfile if needed, builds, and serves on loopback.

## Observed fixture result

The fixture workflow completes and the optimizer reports **no improvement**. The quality dashboard excludes fixture runs from live sample size and cost per correct task. These observations establish UI and persistence behavior only.

## Pending live acceptance

A short standalone Sapiom Router connectivity request completed with a 148-token usage report; its individual dollar charge remains unknown. The Ablatrix agent deployed as ready builds `2217` through `2220` under definition `872`. Production execution `728875` failed after three attempts because `llm.structuredOf` returned no answer object; its Run Inspector charge was $0.03. Execution `729073` failed after one attempt because neither a structured tool result nor usable JSON text was returned; its charge was $0.01. Execution `729546` failed after one attempt because the routed model reached the 1,024-token limit before emitting JSON; its charge was $0.01. Execution `729568` failed after one attempt with `stop=end_turn` and non-JSON text despite a 4,096-token limit; its charge was $0.01. The visible account balance was $14.94 from $15.00 after these runs. Billing showed no payment method and disabled auto top-up; no enforceable $10 project spending rule was visible. The branch now requests a structured output tool with the larger budget, accepts fenced JSON as fallback, validates the answer and source quote, and emits bounded response-shape diagnostics when parsing fails. This local revision passed typecheck, graph check, and a fully stubbed structured-output run; it has not been deployed or production-tested. No successful production research result, live quality comparison, complete provider price attribution, or break-even calculation has been performed. Live acceptance requires an enforceable Sapiom spending rule and metering for both proposal and experiment calls. Until then, the application remains a working local fixture-mode product with a guarded live adapter, not a validated performance win.

The corrective follow-up adds a fake metered provider test path and shared SQLite reservations. It does not unlock the real provider: see [the accounting boundary](sapiom-accounting.md). Passing injected-provider tests proves the orchestration and accounting assumptions in code, not Sapiom's actual charge or cap behavior.

The pilot suite has six model-drafted source-grounded tasks, including two sealed holdouts. The suite is too small for a general performance claim, and its labels need independent review before any benchmark publication. Fake-provider tests cover successful priced comparison, no improvement, quality regression, malformed/timed-out proposal, unknown research charge, and budget refusal. Browser tests cover blocked live readiness and a one-time synthetic holdout after candidate selection.

The deterministic rubric detects missing required terms, an unapproved source host, and citations absent from returned sources. A negative sentence containing the required terms can still pass; a regression test preserves that known false-positive example. A human semantic review or stronger independent grader is required before treating pilot pass rate as truth.
