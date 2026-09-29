# AI source-read drafts for the 20-answer paid batch

Codex read each saved answer and the full supplied product excerpts, then checked the [original customer Q&A questions](source-context.json) against the pinned upstream ePQA train file. The paid model had seen only the answer portion of those Q&A excerpts; the original questions are restored **for review only**. The [machine-readable draft packet](ai-review-drafts.json) records an answer verdict, support verdict, confidence, source hashes, and a case-specific note for all 20 questions. These are **AI-only suggestions**, not independent human judgments or a measured accuracy result. They do not satisfy Ablatrix's promotion gate. The review page leaves source checkboxes, reviewer identity, and final confirmation blank even when a suggestion is used to prefill the form.

| AI-only assessment | Cases |
| --- | --- |
| Likely correct and supported | 17 |
| Likely incorrect | 1: Q19 |
| Uncertain; needs human adjudication | 2: Q25, Q72 |

## Likely misses to verify first

- **Q19, Frigidaire crisper drawer:** The answer claims the OEM part matches the present questioner's model. That customer Q&A actually answered a *different Kenmore model*. The listing identifies part `240337103`, while the current question names `241543917`; fit or interchangeability has not been established by these excerpts.

Q25 needs an adequacy judgment: the hose Q&A reports inside diameters, while separate faucet-adapter excerpts list thread sizes without establishing all inlet and drain fittings. Q72 also needs an adequacy judgment: rear exhaust is supported, while manufactured-home installation and duct compatibility remain unresolved. Q81's apparently affirmative Q&A answered a different Kenmore model, so the answer's caution about the asked KitchenAid model is reasonable.

The next gate is a person checking the sources and submitting their own judgments. Until then the paid-batch human review counter remains **0/20**. No additional Sapiom calls or policy changes were made for this packet.
