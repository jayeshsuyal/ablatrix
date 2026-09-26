"""Render the saved live diagnostic as an anonymous human review sheet."""

import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
packet = json.loads((root / "docs/evidence/citation-snippet-diagnostic-2026-09-25.json").read_text())
corpus = json.loads((root / "data/product-qa/corpus.json").read_text())
products = {item["id"]: item for item in corpus["products"]}
passages = corpus["passages"]
lines = [
    "# Anonymous source-grounded answer review",
    "",
    "Two recorded development questions. For each answer, judge correctness and evidence support independently. A citation being a literal quote does not prove it supports the claim. Do not use model status or preference as a factual score. The arm identities and technical metadata are withheld here.",
    "",
    "For each answer, record: **correct yes/no**, **supported yes/no**, any **failure category and correction**, the **source IDs you checked**, and your **reviewer name**. You may separately state A/B/tie/neither as a preference. Do not infer an improvement from these reused development questions.",
    "",
]
for case in packet["cases"]:
    case_id = case["caseId"]
    lines += [f"## {case['question']}", "", f"Product: {products[case['productId']]['title']} · development case `{case_id}`", ""]
    answers = [step for step in packet["steps"] if step["caseId"] == case_id]
    for label, step in zip("AB", answers):
        answer = step.get("answer")
        lines += [f"### Answer {label}", "", answer["answer"] if answer else "No saved answer.", "", "Cited source excerpts:", ""]
        for citation in answer["citations"] if answer else []:
            lines.append(f"- `{citation['passageId']}`: “{citation['quote']}”")
        lines += ["", f"**Review {label}:** Correct ___ · Supported ___ · Failure category ___ · Correction ___ · Checked source IDs ___ · Reviewer ___", ""]
    lines += ["**Optional preference:** A / B / tie / neither · Reason: ___", "", "<details><summary>Complete product evidence for source checking</summary>", ""]
    for passage in passages:
        if passage["productId"] == case["productId"]:
            lines += [f"**{passage['id']} · {passage['source']}**", "", passage["text"], "", f"Reference: {passage['reference']}", ""]
    lines += ["</details>", ""]
output = root / "docs/evidence/citation-snippet-blind-review-2026-09-25.md"
output.write_text("\n".join(lines))
print(f"Wrote {output} with {len(packet['steps'])} anonymous answers.")
