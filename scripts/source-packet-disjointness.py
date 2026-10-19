#!/usr/bin/env python3
"""Next-protocol packet guard; never changes or reclassifies frozen studies."""
import hashlib
import json
import re
import sys

def fingerprint(source):
    normalize = lambda text: re.sub(r'\s+', ' ', text.strip().lower())
    raw = json.dumps([normalize(source['text']), normalize(source.get('originalQuestion') or '')], ensure_ascii=False, separators=(',', ':'))
    return hashlib.sha256(raw.encode()).hexdigest()

def verify(cases, protected=()):
    seen = {fingerprint(source): 'protected_history' for case in protected for source in case['sources']}
    overlaps = []
    for case in cases:
        current = {fingerprint(source) for source in case['sources']}
        overlaps.extend({'caseId': case['id'], 'priorCaseId': seen[value], 'packetSha256': value} for value in sorted(current) if value in seen)
        for value in current:
            seen.setdefault(value, case['id'])
    return {'format': 'source-packet-disjointness-v3', 'passed': not overlaps, 'overlaps': overlaps, 'casesRetained': len(cases), 'historicalResultsChanged': False}

if __name__ == '__main__':
    document = json.load(open(sys.argv[1]))
    result = verify(document['cases'])
    print(json.dumps(result, indent=2))
    sys.exit(0 if result['passed'] else 1)
