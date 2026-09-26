"""Render an anonymous source-grounded answer sheet from one calibration packet."""

import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
phase = sys.argv[1] if len(sys.argv) > 1 else "development-restart"
if phase not in {"development-restart", "validation", "revision2-development", "revision2-validation"}:
    raise SystemExit("unsupported review-sheet phase")
date = "2026-09-25"
packet_path = root / f"docs/evidence/answer-calibration-{phase}-{date}.json"
sheet_path = root / f"docs/evidence/answer-calibration-{phase}-blind-review-{date}.md"
packet = json.loads(packet_path.read_text())
if len(packet["steps"]) != len(packet["cases"]) * 2 or any(
    step["status"] != "passed_execution" for step in packet["steps"]
):
    raise SystemExit("all paired answers must pass execution before review")
corpus = json.loads((root / "data/product-qa/corpus.json").read_text())
products = {item["id"]: item for item in corpus["products"]}
lines = [
    "# Anonymous answer-calibration review",
    "",
    "AI review only. Judge each answer separately from the full product evidence. Do not use model status as a score. Arm identities, timing, tokens, and policy text are absent from this sheet.",
    "",
    "For each answer record: **claim support** (all material claims warranted?), **answer adequacy** (each supported part directly answered, with appropriate uncertainty?), and **citation relevance** (quoted source supports the associated claim?). List checked passage IDs and material issues. Then state A/B/tie/neither preference separately.",
    "",
]
for case in packet["cases"]:
    lines += [
        "## " + case["question"],
        "",
        "Product: " + products[case["productId"]]["title"] + " · case " + case["caseId"],
        "",
    ]
    answers = [step for step in packet["steps"] if step["caseId"] == case["caseId"]]
    for label, step in zip("AB", answers):
        answer = step["answer"]
        lines += ["### Answer " + label, "", answer["answer"], "", "Cited excerpts:", ""]
        for citation in answer["citations"]:
            lines.append("- " + citation["passageId"] + ': “' + citation["quote"] + '”')
        lines += ["", "**Review " + label + ":** Claim support ___ · Answer adequacy ___ · Citation relevance ___ · Issues/correction ___ · Checked passage IDs ___", ""]
    lines += ["**Optional preference:** A / B / tie / neither · Reason ___", "", "<details><summary>Complete product evidence</summary>", ""]
    for passage in corpus["passages"]:
        if passage["productId"] == case["productId"]:
            lines += ["**" + passage["id"] + " · " + passage["source"] + "**", "", passage["text"], "", "Reference: " + passage["reference"], ""]
    lines += ["</details>", ""]
sheet_path.write_text("\n".join(lines))
print(sheet_path)
