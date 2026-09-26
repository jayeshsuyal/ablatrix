# First live candidate: partial answers from reviewed feedback

On September 25, 2026, the cabinet materials development answer (`epqa-train-775`) received a human review: **supported, incorrect**, category `unnecessary_abstention`. The reviewer checked four product passages and supplied a correction. This is one reviewed failure, not an estimate of overall baseline quality.

One live Sapiom proposal call created candidate `f9f3e212-5691-48d9-aaf3-0fd8ad79aff9`, parent `live-baseline`, from run `65927dbb-3c07-4609-9985-e063fb7f160f`. Its saved instructions are:

> Answer the selected product question using only the supplied evidence. Cite exact supporting quotes and passage IDs. Distinguish manufacturer specifications from customer reports. If the evidence is insufficient or conflicting, explain the limitation, but still provide the most specific conclusion that the evidence supports; abstain only from the unresolved portion of the question. Never invent a specification or transfer evidence between products.

The candidate was **never active**. The Native Union authenticity development answer (`epqa-train-647`) subsequently received a source-checked human judgment of correct and supported. Its conflicting product listing and customer reports made it the selected regression control.

The local planning ledger moved from 15 to 16 of 60 allowed calls, reserving $0.10 for the proposal. Provider-billed cost is unavailable.

## First paired validation outcome

Validation `2a30aaf2-b5ce-4591-a547-f7e0ae7052ae` used two fresh products (`epqa-dev-469`, `epqa-dev-505`) and the reviewed Native Union control. The baseline and candidate received the same retrieved passages for each question, with alternating answer order. All six Sapiom requests completed and are in the local budget ledger (22/60 total calls, $2.20 cumulative planning allowance). Five answers passed execution checks. The candidate's Native Union answer failed the exact-quote provenance check: one citation did not occur verbatim in its supplied passage. The raw rejected answer is not stored, so the record establishes a citation mismatch, not its wording or cause.

The validation and candidate are **rejected** by the predeclared execution gate. The two fresh validation products are consumed and cannot be reused for a new candidate round. The five completed answers are not a complete blind comparison and have no human correctness judgments. `live-baseline` remains active. No answer-quality gain, loss margin, or promotion is claimed.
