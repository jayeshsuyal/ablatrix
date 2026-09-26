# v0.3: inspect requested details before another policy trial

The two exploratory policies changed the model's `answered` status more readily than they changed the substance of its response. This slice records a more specific review of shopper questions while retaining the existing human correctness and support gate. It does not promote either shadow policy.

## Review contract

A reviewer may record up to six requested details for an answer. Each detail records (1) the shopper's requested fact, (2) whether the evidence is an explicit listing claim, a customer report, conflicting, or missing, and (3) whether the response clearly addressed it, appropriately qualified it, missed it, or overstated it. Checked source IDs, the overall correctness and support judgment, and reviewer identity remain required by the existing review form. These detail annotations are an aid to interpreting the judgment; they are not an automatic correctness score. The model's own `answered` flag is displayed as a model label until a review is saved.

After independent AI review, new detail rows now require the reviewer to choose both evidence and answer assessments before saving; neither starts with a favorable default. The live answer list highlights the saved cabinet and Native Union cases for the immediate source check. This navigation opens existing records and does not call a model.

The final report now counts a response with unsupported content whenever its reviewer marks `supported: false`, including responses the model called `insufficient_evidence`. The old count could understate unsupported content. Existing reviewed good counts and strict promotion rules remain based on `correct && supported`.

Validation offers a choice of up to two reviewed correct development questions as regression controls. The UI requires a deliberate choice when such controls exist. The server checks that each requested control is a reviewed, correct case from the parent policy. Two separate fresh validation products remain mandatory in each round. Requests from older clients without a selection continue to use the first two eligible controls; this compatibility default should not be used for a new live experiment without recording why those controls were chosen.
The UI clears control selections when the mode or candidate changes, opens the control picker while a choice is required, and explains why the validation button is disabled.

The export format is `ablatrix-feedback-loop-v0.3` because saved feedback can now contain detail annotations and the unsupported count has corrected meaning. The v0.2 protocol and its exploratory artifacts remain historical records. Any live v0.3 quality comparison must use the same review rubric for both arms, keep validation products unseen during policy development, and report its human review provenance.

## Read of six saved answers, without new model calls

This is an AI-assisted exploratory read of the historical baseline plus two shadow candidates for each of the two development questions. The complete answers and quote citations are in the [first shadow packet](evidence/feedback-v02-shadow-policy-2026-09-25.json) and [replacement-policy packet](evidence/feedback-v02-shadow-policy-revision2-2026-09-25.json). These annotations are not saved human feedback.

- **Cabinet wood material:** all three answers report that the listing says engineered wood and distinguish customer descriptions of particle board or pressed wood. Wood species is absent from the evidence. The listing also explicitly includes glass as a material; none of the three answers plainly resolves the shopper's “real glass” concern beyond stating that listing claim. The second candidate separates the parts more clearly, yet still imposes an independent-verification caveat. A reviewer must decide whether that caveat is appropriate for this shopping question.
- **Native Union authenticity:** all three answers correctly distinguish the advertised Native Union brand from conflicting customer reports about authenticity. The baseline and first shadow answer use `insufficient_evidence`; the second shadow answer uses `answered` while still saying authenticity is unresolved. That status flip alone gives no evidence of improved answer quality and may mislead a shopper.

Under this rubric, the saved packets show **no demonstrated substantive gain**. An independent human judgment of cabinet adequacy and the authenticity control is the next decision point. If the baseline cabinet answer is accepted, collect fresh development failures before proposing a policy. If it is judged inadequate, use that source-checked correction to propose one generic change and compare it on two fresh validation products with Native Union explicitly selected as a regression control.
