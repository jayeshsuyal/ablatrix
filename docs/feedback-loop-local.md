# Local product QA feedback loop

The `/loop` workspace implements the proposed flow in [feedback-loop-roadmap.md](feedback-loop-roadmap.md): answer, review, propose one answer-policy update, validate, promote or reject, and roll back. The model, corpus, chunking, and hybrid retrieval settings stay fixed during policy comparisons.

## Start

```sh
npm ci
npm run feedback:prepare
npm run feedback:prepare -- --final
npm run feedback:retrieval-audit
npm run local
```

Open `http://127.0.0.1:4173/loop`. When saved live evidence exists, the landing view opens its official decision; the separate exploratory AI assessment has its own entry. Choose Synthetic demo for the scripted workflow. A different `PORT` may be supplied when starting the app. Initial embedding preparation downloads pinned public BGE weights to `.data/models`; subsequent runs reuse that cache. Both preparation commands make no Sapiom calls. All application state is local SQLite storage under `.data`.

The product corpus comes from a frozen subset of Amazon ePQA development material. Preserve the included attribution and license. Dataset relevance/answer annotations still require independent review; they are not automatically proof of answer quality. Search only uses source passages, never reference answers or evaluation labels.

## Synthetic demonstration

1. Select **Synthetic demo**, a development product and question, and generate an answer.
2. Inspect the evidence, explicitly review correctness/support, identify the failure, and enter a correction with supporting passage IDs.
3. Propose a policy update from reviewed development failures. Inspect its parent, instructions, rationale, and feedback provenance.
4. Validate the candidate. The synthetic path uses scripted responses and synthetic review outcomes to exercise the workflow.
5. Apply the decision, inspect the active version, and test rollback. Export the saved trace if needed.

Synthetic answers, proposal behavior, and validation grades demonstrate orchestration only. Their apparent improvement is not measured LLM improvement. Actual retrieval uses the local embedding model even in this demonstration.

## Exploratory live mode

Configure server-side credentials and the approved local spending plan using `.env.example`. Either `SAPIOM_API_KEY` or an explicit `SAPIOM_CREDENTIALS_FILE` referring to the user's own Sapiom CLI credential file may be used. Credentials never reach the browser or evidence export.

Set `ABLATRIX_LOOP_LIVE=1`, the approved `ABLATRIX_SPEND_CAP_USD`, and an accurate `ABLATRIX_LOOP_PRIOR_SPEND_USD`. The default call limit is 20; the current ignored local `.env` sets 60 calls so a ten-question batch, proposal, validation and 40-answer final comparison fit under the approved $10 planning cap. A $0.10 allowance is retained for every attempted call, including failures. This local ledger is not provider settlement or a provider-enforced hard ceiling. The previously authorized exploratory arrangement allows this distinction; live billed-cost claims remain unavailable.

Live answers and proposals use the named Sapiom `gpt-luna` Router alias, `run_now`, a 4,096-token output bound, and no reasoning effort. The live app uses preselected snippet IDs for answer citations and maps them to exact saved quotes. Returned model identity must match the known alias family. Calls are not automatically retried, and failed live answers stop further batch or validation dispatch. Both policies in a validation are evaluated under the same model constraints. Review each live validation answer against its evidence before deciding; an optimizer never supplies its own human correctness label.

The saved standalone revision 2 validation packet is imported into the app's reservation ledger at startup. The app and standalone runner share consumed validation products. Four of six validation products have been used across the first official and standalone rounds. The two remaining products are reserved for a frozen future comparison. The offline retrieval audit uses development cases only and reports passage coverage, with the annotation limits described in [the backend audit](backend-consolidation-2026-09-26.md).
Current retrieval indexes the answer portion of customer Q&A while preserving the full passage for citations. Earlier saved live comparisons used the prior index; compare future policy arms only under one frozen retrieval method.

## What gets saved

- Product evidence, source references, corpus hashes, and model/retrieval identity.
- Each run's question, policy version, exact retrieved passages, answer, citations, usage when returned, duration, and errors.
- Structured feedback with reviewer attribution, correction, evidence references, and synthetic/human provenance.
- Immutable policy content and parent relationships; validation results; active-version changes and rollback events.
- Durable attempted-call planning allowances, separately from unknown billed costs.

Interrupted work is recorded rather than replayed automatically. A promotion requires complete source-checked reviews, a gain on fresh validation products, and no observed regressions across fresh products or development controls. A passing local decision is not a generalization claim. v0.2 adds a frozen ten-question development batch, blind review cards during paired validation, and an unlabeled 20-product final comparison. The final report appears only after every paired answer is reviewed. See [the exact protocol and limits](feedback-loop-v0.2-protocol.md).

## Optional Langfuse export

History includes an optional Langfuse connection and sync card. Configure the project's server-side settings, then explicitly export eligible saved live runs and confirmed human scores. Blind comparisons stay excluded until their reviewed decision or final report. The local experiment works with this integration disabled. See [Langfuse setup, exported fields and delivery limits](langfuse.md).

## Verification

```sh
npm test
npm run build
npm run test:e2e
```

Provider tests use injected responses and do not call Sapiom. Retrieval tests inject deterministic vectors; `feedback:prepare` exercises the real local embedding runtime. Browser tests identify synthetic output explicitly. Live smoke-test results, if collected, are documented separately from synthetic integration tests.

Current results: [v0.1 implementation evidence](feedback-loop-v0.1-evidence.md). The development workspace currently runs on port 4189 with its configuration saved in the ignored `.env`; `npm start` restarts the same local workspace. A fresh clone uses the documented default port unless configured otherwise.
