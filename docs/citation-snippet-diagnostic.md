# Citation snippet diagnostic: four live development calls

This is a separate, exploratory experiment on September 25, 2026. It does not reopen validation `2a30aaf2-b5ce-4591-a547-f7e0ae7052ae`, reuse its two consumed validation products, or change the active `live-baseline` policy. The tested answer policy is the previously rejected partial-answer candidate `f9f3e212-5691-48d9-aaf3-0fd8ad79aff9`.

## Hypothesis and controls

The observed validation failure was one non-verbatim citation in the candidate's Native Union control answer. The rejected raw answer was not retained, so its exact wording and cause are unknown. This diagnostic tests whether requiring the model to **select a server-provided literal quote ID** eliminates that class of formatting error. The server maps the selected ID to its saved passage and exact substring. An unknown ID or an `answered` output without a citation fails the new arm's execution check.

Two already-used **development** questions were selected before the calls: cabinet materials (`epqa-train-775`) and Native Union authenticity (`epqa-train-647`). Each pair used the same saved retrieved passages, the same rejected policy instructions, `gpt-luna` with 4,096 max output tokens and no reasoning effort, and the same Sapiom Router lane. The raw-quote arm asked the model to emit passage IDs plus copied quote text. The snippet-ID arm provided six literal quote options for each question and asked it to return option IDs. Arm order alternated by question. This changes the citation interface and prompt size; it is not a pure model-weight or retrieval comparison.

## Observed execution

| Development question | Raw quote | Snippet ID | Human answer review |
| --- | --- | --- | --- |
| Cabinet materials | Passed exact-quote check; `insufficient_evidence` | Passed exact-quote check; `answered` | Pending |
| Native Union authenticity | Passed exact-quote check; `answered` | Passed exact-quote check; `answered` | Pending |

All four calls returned `gpt-5.6-luna` and all emitted citations matched literal substrings in the supplied passages. The snippet-ID arms resolved valid option IDs into literal quotes. Since **both arms passed on both questions**, these four observations show no measured reduction in citation failures. The cabinet status difference does not establish a correctness gain; a reviewer must judge the actual content and source support. The candidate remains rejected and the baseline remains active.

The calls moved the shared local ledger from **22/60 to 26/60**, adding **$0.40 of planning allowances** ($2.60 cumulative). Actual provider-billed charges are unavailable in this app. The exact answers, citations, passage IDs, quote options, token counts, and durations are in [the saved packet](evidence/citation-snippet-diagnostic-2026-09-25.json). The [anonymous review sheet](evidence/citation-snippet-blind-review-2026-09-25.md) hides arm identity and execution metadata for independent source-grounded judgments. Those judgments must stay separate from the automatic exact-substring check.

A separate [GPT-6 Astra AI assessment](evidence/citation-snippet-astra-review-2026-09-25.md) judged both cabinet answers too cautious about the listed glass material and both Native Union answers acceptable. It narrowly preferred the snippet-ID cabinet answer and tied the Native Union pair, but found no fully correct cabinet answer. This is a provisional AI judgment, not human review or a validated quality gain.

## Interpretation

The server-selected quote mechanism can enforce literal quote membership for valid IDs, but it cannot establish that a quote supports a particular claim or that the answer is correct. This tiny reused-development sample cannot estimate a failure rate or justify promotion. A future validation of answer quality still needs a new frozen protocol, unused product-disjoint questions, and independent human reviews. The four untouched validation products remain available for such a round.
