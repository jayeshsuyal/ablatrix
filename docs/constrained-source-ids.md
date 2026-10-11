# Citation IDs declared in each response schema

The [stopped source-ID run](evidence/source-id-correction-2026-10-10/live-report.md) exposed a copy error: one returned ID omitted its last character. The `source_ids_v2` interface declares the exact offered IDs as a JSON Schema `enum` for `citations[].quoteId`. Each original and revision request derives that enum from its own ordered source catalog.

For the observed failed selection, the complete ID is permitted and the shortened ID is not:

```json
{
  "quoteId": {
    "type": "string",
    "enum": ["src_d6dec31ee5a0006a8e2e684a"]
  }
}
```

This is a shortened schema example; a real request includes every offered ID in order. The server still rejects unknown or foreign IDs, duplicate citations, unresolved ID markers and citationless `answered` outputs. It never guesses the intended source from a malformed selection.

## Explicit use and audit records

Use `answerWithConstrainedSourceIds()` or `reviseWithConstrainedSourceIds()` for generation. Their pure counterparts, `constrainedSourceIdAnswerRequestBody()` and `constrainedSourceIdRevisionRequestBody()`, construct the exact body before dispatch. Select `correctionComparisonProtocol(modelAlias, codeCommit, 'source_ids_v2')` for a new comparison.

Version 2 reuses the full-body catalog and scoped source-ID resolver. It introduces separate prompt versions, tool names, explicit ID-selection guidance and a response schema whose legal IDs depend on the request. Each returned result and receipt records the interface, instruction identity, `optionSetSha256` and `responseSchemaSha256`; the latter hashes the exact dispatched tool parameters. Comparison request hashes bind the full case-specific enum. Historical `source_ids_v1`, passage-quote and snippet interfaces keep their original request identities, so old packets remain inspectable.

## Reproduce offline

```sh
node --import tsx --test server/constrained-source-ids.test.ts
npm test
npm run build
```

Tests use synthetic responses and isolated ledgers. The regression uses the public frozen source context from the failed case, including the exact shortened ID; it does not inspect successful private answer text. It checks legal selections, rejection without repair/retry, actual request/schema/receipt parity and request isolation. Comparison checks cover the explicit version 2 interface and preserve blind review gates.

The [offline qualification record](evidence/constrained-source-ids-2026-10-11/offline-qualification.json) binds the verified implementation and test files. It establishes request and resolver behavior with injected responses. The subsequent [approved live diagnostic](evidence/source-id-diagnostic-2026-10-11/live-report.md) stopped after five of six planned attempts: four accepted outputs with 12/12 full-source citation matches, then two valid IDs returned in an invalid string-array shape. One revision remained unattempted; two of three diagnostic targets were observed. **Sapiom enforcement of constrained decoding remains unverified; declared schemas did not prevent this invalid response shape.** A schema enum does not establish claim support, answer correctness or human-reviewed improvement. Because version 2 also adds prompt guidance, a future comparison would test the combined interface change rather than isolate the enum's causal effect.

The original implementation qualification made zero paid calls. Its historical source-ID comparison remains stopped, with eight attempts and two of eight planned pairs completed. The separate diagnostic used a prospectively frozen manifest and explicit six-call approval; it added five attempts and $0.50 local planning allowance. No retry, human quality judgment or policy promotion followed. Further paid execution requires separate approval and a new frozen plan.
