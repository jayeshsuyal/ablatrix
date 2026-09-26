# GitHub Actions source-given Q&A pilot

`suite.json` contains 12 new agent-authored scenario questions: 4 development tasks and 8 evaluation tasks. Each task uses a different official GitHub Docs page, so no source page occurs in both splits. The previous multi-entity pilot in `data/tasks.v2.json` is a separate dataset.

The scope is answering short GitHub Actions questions from supplied documentation context. Each excerpt includes the relevant rule together with adjacent explanations, conditions, or examples. This remains a narrow pilot: it does not test finding sources, selecting relevant material from full pages, or general factual accuracy. Evaluation questions and labels are present in this local file for review. They are not a secret or independently administered holdout. Do not use evaluation tasks to select or revise a candidate configuration.

The label status is **source-checked-by-agent; human-review-pending**. The authoring agent read the current official documentation and checked each answer against its supporting excerpt. No independent human review or paid model experiment was performed to prepare this dataset. Expected answers and `requiredFacts` are agent-authored semantic reference claims, not a substitute for semantic review of model responses.

Each `sources[].text` is a frozen contextual excerpt, rather than a complete page. The 12 excerpts contain 332–887 characters each, with one to three adjacent prose paragraphs or list items and relevant section headings or examples where present. Source text was retrieved directly from the official pages' rendered article content. HTML entities were decoded, paragraph whitespace was normalized, link labels were retained as text, and inline code was represented with Markdown backticks. The artifact retention example retains its line breaks in a code fence; its duplicate display/copy representation was omitted. No surrounding prose was invented or paraphrased.

`capturedAt` records the UTC snapshot time, not the document publication time. `sha256` is the lowercase SHA-256 digest of the exact UTF-8 `text` string, without adding a trailing newline. Each task's original, short `supportQuote` occurs verbatim in its assigned contextual source text. The source title and URL identify the original page, and URL fragments identify the relevant section where available. Online documentation can subsequently change.

## Attribution and license

Documentation excerpts are attributed to **GitHub, Inc. and the GitHub Docs contributors**. Each excerpt's title and original URL are recorded in `suite.json`. The [official GitHub Docs repository](https://github.com/github/docs#license) identifies its documentation and content as licensed under [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/), with the full license in [github/docs/LICENSE](https://github.com/github/docs/blob/main/LICENSE). The license and repository attribution were checked on 2026-09-24.

This dataset selects contextual portions of that documentation and adds original questions, answers, split assignments, review labels, and integrity metadata. The selected prose has not been paraphrased in `text`; the rest of each article and its page presentation have been omitted. This adaptation does not imply endorsement by GitHub. Retain the source attribution and license links when redistributing the excerpts.

## Dataset checks

The construction check verified 12 unique task IDs and questions, 4 development tasks, 8 evaluation tasks, 12 distinct source pages, valid source references, exact support-quote membership, and recomputed SHA-256 hashes. The contextual snapshot update preserved every task, question, answer, required fact, and support quote; every expanded excerpt was checked against the freshly retrieved official page and falls within 300–1,200 characters. Those mechanical checks establish file integrity and quote provenance; the labels still require human review before relying on quality scores.
