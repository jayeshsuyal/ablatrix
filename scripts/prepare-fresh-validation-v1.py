#!/usr/bin/env python3
"""Prospective, source-only v1: freeze first; review before reading any fresh packet.

No dataset loader, provider, credential, environment-file or paid execution path.
Public historical artifacts are exclusion-only inputs, never answer labels.
"""
import argparse
import datetime
import hashlib
import importlib.util
import json
import os
import pathlib
import re
import subprocess
import unicodedata

ROOT = pathlib.Path(__file__).resolve().parents[1]
HERE = pathlib.Path(__file__).resolve()
spec = importlib.util.spec_from_file_location('fresh_packet_guard', HERE.with_name('source-packet-disjointness.py'))
packet = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packet)
FORMAT = 'ablatrix-fresh-validation-protocol-v1'
SEED = 'ablatrix-fresh-product-validation-2026-10-19-v1'
EVIDENCE = 'docs/evidence/retrieval-validation-prospective-2026-10-19'
V5 = 'docs/evidence/retrieval-diagnosis-2026-10-19/semantic-supplement-v5-freeze-v2.json'
V5_SHA = '24f85ef7f659ba52211d3f57fb7a205d702eda4e86c874f186b2abb8dc14a6b9'
REQUIRED_HISTORY = {
    'docs/evidence/retrieval-diagnosis-2026-10-19/frozen-v2-public-inputs-v1.json',
    'docs/evidence/retrieval-source-gap-exploratory-2026-10-18/pool-v2.json',
    'docs/evidence/retrieval-source-coverage-v2-2026-10-18/deck-v1.json',
    'docs/evidence/answer-quality-source-calibration-2026-10-18/cohort-v1.json',
    'docs/evidence/retrieval-source-coverage-2026-10-18/cohort-v1.json',
    'docs/evidence/source-id-correction-2026-10-10/exposure-audit.json',
    'data/product-qa/corpus.json', 'data/product-qa/final-corpus.json',
}
CODE = ['scripts/prepare-fresh-validation-v1.py', 'scripts/source-packet-disjointness.py',
        'scripts/fresh-validation-contexts-v1.ts', 'scripts/prepare-three-context-fresh-v1.ts', 'server/fresh-validation-v1.ts',
        'server/semantic-supplement-v5.ts', 'server/semantic-reranker-v4.ts',
        'server/semantic-reranker.ts', 'server/product-retrieval.ts',
        'server/product-corpus.ts', 'server/workspace-retrieval-context.ts',
        'server/answer-review-source.ts', 'server/retrieval-diagnosis-replay.ts', 'package.json', 'package-lock.json']
ASIN = re.compile(r'\bB[A-Z0-9]{9}\b')
DIGEST = re.compile(r'[a-f0-9]{64}')
TAGS = {'supported_gap', 'baseline_complete_control', 'conflicting_reports', 'insufficient_evidence', 'uncertain'}
MINIMA = {'supported_gap': 1, 'baseline_complete_control': 2, 'conflicting_reports': 1, 'insufficient_evidence': 1}
IDENTIFIER_ARRAYS = ('protectedTargetIdentifiers', 'modelIdentifiers', 'manuallyConsideredIdentifiers',
                     'fullContextModelIdentifiers', 'questionTargetIdentifiers', 'titleModelIdentifiers',
                     'requestedIdentifiers', 'sourceManufacturerBrandIdentifiers', 'protectedExactIdentifierMatches',
                     'protectedExactIdentifierConflicts', 'protectedNearIdentifierConflicts',
                     'protectedExactOrNearIdentifierConflicts', 'selectedPeerIdentifierConflicts')

def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))

def sha(value):
    return hashlib.sha256(value if isinstance(value, bytes) else value.encode()).hexdigest()

def seal(value):
    return sha(json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True))

def norm(value):
    return ' '.join(unicodedata.normalize('NFKC', value).casefold().split())

def scoped_fingerprint(source):
    return sha(compact([norm(source['text']), norm(source.get('originalQuestion') or '')]))

def family(value):
    return re.sub(r'^(?:(?:genuine|oem|original|authentic|official|new)\s+)+', '', norm(value))

def models(value):
    value = norm(value)
    result = set()
    for word in re.findall(r'\b[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)*\b', value):
        token = re.sub(r'[^a-z0-9]', '', word.casefold())
        if len(token) < 4 or not any(c.isdigit() for c in token):
            continue
        if re.fullmatch(r'\d+(?:gal(?:lons?)?|g|oz|qt|pint|l|ml|cl|dl|yd|yards?|in|inch(?:es)?|ft|feet|cm|mm|xh|gbs|mbps|gbps|meters?|metres?|gb|tb|mah|watts?|volts?|amps?|w|v|a|cc|rpm|lbs?|grams?|kilograms?|colors?|packs?|pieces?|speed)', token) or re.fullmatch(r'\d+x\d+', token):
            continue
        if any(c.isalpha() for c in token) or len(token) >= 5:
            result.add(token)
    return result

def family_conflict(left, right):
    a, b = family(left), family(right)
    if not a or not b:
        return False
    brand = lambda t: re.sub(r'[^a-z0-9]', '', t.split()[0]).split('nutone')[0]
    words = lambda t: {x for x in re.findall(r'[a-z0-9]+', t) if len(x) > 2}
    x, y = words(a), words(b)
    return a == b or brand(a) == brand(b) or len(x & y) / max(1, len(x | y)) >= .45

def model_conflict(left, right):
    return bool(left & right) or any(a[:6] == b[:6] or (len(a) == len(b) and sum(x != y for x, y in zip(a, b)) <= 1)
                                   for a in left if len(a) >= 6 for b in right if len(b) >= 6)

def canonical_file(root, name):
    path = pathlib.Path(name)
    if path.is_absolute() or not path.parts or any(x in {'.', '..'} for x in path.parts) or '\\' in name:
        raise ValueError('Use a canonical repository-relative artifact path.')
    result = root / path
    if not result.is_file() or result.is_symlink() or result.resolve(strict=True) != result:
        raise ValueError('Artifacts require canonical regular files; no symlink ancestors.')
    return result

def read(root, name):
    raw = canonical_file(root, name).read_bytes()
    return {'path': name, 'fileSha256': sha(raw), 'document': json.loads(raw)}

def write_new(path, document):
    path = pathlib.Path(path)
    if not path.is_absolute() or path.exists() or path.parent.resolve(strict=True) != path.parent:
        raise ValueError('Use a new absolute output file with an existing canonical parent.')
    with path.open('x') as handle:
        handle.write(json.dumps(document, ensure_ascii=False, indent=2) + '\n')

def historical_paths(root, require_git=False):
    try:
        raw = subprocess.check_output(['git', 'ls-files', '-z', 'docs/evidence', 'data/product-qa'], cwd=root, stderr=subprocess.DEVNULL)
        names = [name for name in raw.decode().split('\0') if name.endswith('.json') and not name.startswith(EVIDENCE + '/')]
    except (OSError, subprocess.CalledProcessError):
        if require_git:
            raise ValueError('Creating a new prospective freeze requires the full Git-tracked historical manifest; archive replay only is supported without Git.')
        # Archive/checkouts without Git use the same complete public file list.
        # Never inspect unrelated private .data/work or untracked grader work.
        names = sorted(p.relative_to(root).as_posix() for base in ('docs/evidence', 'data/product-qa') for p in (root/base).rglob('*.json')
                       if not p.is_symlink() and not p.relative_to(root).as_posix().startswith((EVIDENCE+'/', 'docs/evidence/grader-qualification-live-2026-10-15/')))
    if not REQUIRED_HISTORY <= set(names):
        raise ValueError('Historical inventory lacks required old studies, paid8, failed44, failed12 or public replay bundle.')
    return sorted(names)

def inventory(root, paths):
    """Derive an exact union from raw-bound saved records; preserve source scope.

    Recursively decode public replay bundles. Only identifiers, titles, explicit
    model identifiers and literal source fingerprints leave these old records.
    Generated answers/judgments are never eligibility or ordering inputs.
    """
    products, titles, identifiers, fingerprints = set(), set(), set(), set()
    artifacts, embedded, packet_count = {}, {}, 0
    def walk(value):
        nonlocal packet_count
        if isinstance(value, list):
            for entry in value:
                walk(entry)
        elif isinstance(value, dict):
            # Exact old inventory projections are retained, including models that
            # cannot be rederived from the smaller source packets now published.
            for key in IDENTIFIER_ARRAYS:
                if isinstance(value.get(key), list):
                    for identifier in value[key]:
                        if isinstance(identifier, str) and identifier.strip():
                            identifiers.add(re.sub(r'[^a-z0-9]', '', norm(identifier)))
                            identifiers.update(models(identifier))
            # Explicit digit-free audited lines and manufacturer vocabularies
            # cannot match models(), so retain them as family exclusions too.
            for key in ('manuallyConsideredIdentifiers', 'sourceManufacturerBrandIdentifiers',
                        'sourceEstablishedApplianceBrandVocabulary'):
                if isinstance(value.get(key), list):
                    titles.update(family(x) for x in value[key] if isinstance(x, str) and x.strip()
                                  and (key != 'manuallyConsideredIdentifiers' or not any(c.isdigit() for c in x)))
            for key in ('sourcePacketFingerprints',):
                if isinstance(value.get(key), list):
                    fingerprints.update(x for x in value[key] if isinstance(x, str) and DIGEST.fullmatch(x))
            if isinstance(value.get('question'), str): identifiers.update(models(value['question']))
            for key in ('canonicalFamilyTitles', 'extraTitles'):
                if isinstance(value.get(key), list):
                    titles.update(family(x) for x in value[key] if isinstance(x, str) and x.strip())
            for key in ('title', 'productTitle', 'productFamily'):
                title = value.get(key)
                if isinstance(title, str) and title.strip():
                    titles.add(family(title)); identifiers.update(models(title))
            if isinstance(value.get('text'), str) and value['text'] and any(k in value for k in ('source', 'label', 'originalQuestion')):
                source = {'text': value['text'], 'originalQuestion': value.get('originalQuestion')}
                fingerprints.update((packet.fingerprint(source), scoped_fingerprint(source))); packet_count += 1
                identifiers.update(models(value['text'] + ' ' + (value.get('originalQuestion') or '')))
            # Bundled ignored artifacts are decoded only after their exact raw
            # bytes are checked. Replay does not need .git or ignored work/.
            if isinstance(value.get('utf8'), str) and isinstance(value.get('sha256'), str):
                text = value['utf8']
                if sha(text) != value['sha256']:
                    raise ValueError('Historical embedded artifact raw hash mismatch.')
                if text.lstrip().startswith(('{', '[')):
                    embedded[value['sha256']] = len(text.encode()); walk(json.loads(text))
            for key, entry in value.items():
                if key != 'utf8':
                    walk(entry)
        elif isinstance(value, str):
            products.update(ASIN.findall(value.upper()))
    for name in sorted(paths):
        item = read(root, name); artifacts[name] = item['fileSha256']; walk(item['document'])
    document = {'format': 'ablatrix-protected-history-inventory-v1', 'artifactSha256': artifacts,
                'embeddedArtifactSha256': dict(sorted(embedded.items())),
                'productIds': sorted(products), 'canonicalFamilyTitles': sorted(titles),
                'modelIdentifiers': sorted(identifiers), 'sourcePacketFingerprints': sorted(fingerprints),
                'observations': {'savedArtifacts': len(artifacts), 'embeddedArtifacts': len(embedded),
                                 'sourceOccurrences': packet_count, 'products': len(products),
                                 'families': len(titles), 'models': len(identifiers), 'sourcePackets': len(fingerprints)},
                'projectionOnly': True, 'newFreshSourceReads': 0, 'providerCalls': 0,
                'limitation': 'Conservative exclusion union of every bound public historical source/product record; counts are deduplicated, not sums of study denominators. Fuzzy family/model guards are exclusion heuristics, never compatibility proof.'}
    return {**document, 'inventorySha256': seal(document)}

def protocol_fields():
    return {'format': FORMAT, 'seed': SEED, 'screeningDenominator': 24, 'selectedDenominator': 8,
            'pool': 'Exactly24 externally committed source-only packets; no answers, labels, candidate contexts or test split.',
            'ordering': 'Ascending SHA256 of compact JSON [seed,product.id,question,sourcePoolSha256], then case.id.',
            'minima': MINIMA, 'tagsMayOverlap': True, 'modelDetailGapRequired': False,
            'selection': 'Satisfy source-only tag minima in listed order using first as-yet-unselected reviewed packet, then fill to8 by frozen order. No candidate observation may enter eligibility.',
            'stop': 'Any unreviewed protocol/code/history/pool, missing review row, scope mismatch, insufficient minima, fewer8 accepted packets, candidate replay failure or zero designated missing-unit delivery stops. Retain24 rows/exclusions/uncertainties/misses and all unattempted arms; never reseed or replace.',
            'reviewOrder': ['review exact protocol/candidate/history/code', 'commit finite pool bytes', 'screen source-only packets', 'current baseline only', 'independent complete-source/baseline/title/scope/reference review of every screened row', 'freeze selected8', 'unchanged v5 candidate', 'review context/source delivery and development answer outcome', 'separate exact fresh financial approval', 'three-arm answer comparison'],
            'candidate': {'lineageFreezePath': V5, 'lineageFreezeFileSha256': V5_SHA,
                          'contract': 'workspace-semantic-supplement-v5-dev', 'model': 'Xenova/ms-marco-MiniLM-L-6-v2',
                          'revision': 'a09144355adeed5f58c8ed011d209bf8ee5a1fec', 'dtype': 'q8', 'license': 'Apache-2.0',
                          'query': 'question + single space + exact product title', 'document': 'literal body + original customer question iff present',
                          'maxTokens': 512, 'truncation': False, 'network': 'disabled; cached artifacts only',
                          'floor': 'max(-5,bestLogit-8)', 'mmrPenalty': 3, 'sameScopeNearDuplicateJaccard': .85,
                          'maxParentsScored': 128, 'maxAdditions': 3, 'maxParents': 8, 'maxParentCharacters': 1500, 'maxBodyCharacters': 12000,
                          'baselinePrefix': 'literal parent/body/scope/rank/order preserved', 'tuningOnFresh': False},
            'rubric': ['useful fact completeness with scoped qualifications', 'unsupported material claims', 'exact model/workflow applicability', 'appropriate uncertainty including unknown averages/conflicting reports', 'direct relevance', 'literal citation membership separately from support'],
            'review': 'AI source/answer judgments remain provisional; save complete sources and conceal arm mapping. Focus human source checks on calibration and disagreements. AGENTS.md requires source-checked human judgments plus fresh improvement for claims/promotion.',
            'paid': {'maximumFutureAnswerAttempts': 24, 'retries': 0, 'webCalls': 0, 'graderCalls': 0, 'approval': 'Separate exact fresh scope after reviewed development answer outcome; this protocol has no financial approval.'},
            'qualityClaimEligible': False, 'paidExecutionAuthorized': False, 'providerCalls': 0}

def code_paths(root):
    """Conservative relative TypeScript import closure, including type imports."""
    pending, seen = list(CODE), set()
    while pending:
        name = pending.pop()
        if name in seen:
            continue
        path = canonical_file(root, name)
        seen.add(name)
        if not name.endswith('.ts'):
            continue
        for imported in re.findall(r"(?:from\s*|import\s*(?:\(\s*)?)[\"'](\.{1,2}/[^\"']+)[\"']", path.read_text()):
            target = pathlib.Path(os.path.normpath(path.parent / imported))
            try:
                relative = target.relative_to(root).as_posix()
            except ValueError:
                raise ValueError('Frozen implementation imports outside the repository.') from None
            canonical_file(root, relative)
            pending.append(relative)
    return sorted(seen)


def create_freeze(root, directory):
    directory = pathlib.Path(directory)
    if directory.exists() or directory.parent.resolve(strict=True) != directory.parent:
        raise ValueError('Use a new absolute freeze directory with an existing canonical parent.')
    prior = read(root, V5)
    if prior['fileSha256'] != V5_SHA:
        raise ValueError('Unchanged v5 lineage raw bytes required.')
    for name, expected in prior['document']['codeSha256'].items():
        if sha(canonical_file(root, name).read_bytes()) != expected:
            raise ValueError('V5 lineage implementation changed: ' + name)
    history = inventory(root, historical_paths(root, require_git=True))
    code = {name: sha(canonical_file(root, name).read_bytes()) for name in code_paths(root)}
    created = datetime.datetime.now(datetime.timezone.utc).isoformat()
    protocol = protocol_fields()
    protocol['createdAt'] = created
    protocol['historyInventorySha256'] = history['inventorySha256']
    protocol['implementationSha256'] = code
    protocol['protocolSha256'] = seal(protocol)
    directory.mkdir()
    write_new(directory / 'history-inventory-v1.json', history)
    write_new(directory / 'protocol-v1.json', protocol)
    freeze = {'format': 'ablatrix-fresh-validation-candidate-freeze-v1', 'createdAt': created,
              'protocolFileSha256': sha((directory / 'protocol-v1.json').read_bytes()),
              'historyInventoryFileSha256': sha((directory / 'history-inventory-v1.json').read_bytes()),
              'implementationSha256': code, 'candidate': protocol['candidate'],
              'freshInputRead': False, 'frozen': True, 'providerCalls': 0, 'paidExecutionAuthorized': False}
    write_new(directory / 'candidate-freeze-v1.json', freeze)
    pending = {'format': 'ablatrix-fresh-validation-source-screening-qualification-v1', 'status': 'review_pending',
               'protocolFileSha256': freeze['protocolFileSha256'], 'historyInventoryFileSha256': freeze['historyInventoryFileSha256'],
               'candidateFreezeFileSha256': sha((directory / 'candidate-freeze-v1.json').read_bytes()),
               'poolFileSha256': None, 'reviewer': None, 'reviewedAt': None, 'freshInputsInspectedBeforeReview': False,
               'reason': 'No fresh pool may be read until exact code/protocol/history review plus finite pool byte commitment is independently saved.',
               'providerCalls': 0, 'paidExecutionAuthorized': False}
    write_new(directory / 'qualification-pending-v1.json', pending)
    return {'mode': 'prospective_frozen_no_fresh_reads', 'history': history['observations'], 'directory': str(directory),
            'protocolFileSha256': freeze['protocolFileSha256'], 'candidateFreezeFileSha256': pending['candidateFreezeFileSha256'],
            'stopReason': 'protocol_code_review_pending', 'freshInputReads': 0, 'providerCalls': 0}

def verify_freeze(root, directory):
    directory = pathlib.Path(directory)
    if not directory.is_absolute(): directory = root / directory
    relative = directory.relative_to(root).as_posix()
    p, f, h = [read(root, relative + '/' + name) for name in ('protocol-v1.json', 'candidate-freeze-v1.json', 'history-inventory-v1.json')]
    protocol, freeze, history = p['document'], f['document'], h['document']
    check = dict(protocol); digest = check.pop('protocolSha256', None)
    if digest != seal(check) or any(protocol.get(k) != v for k, v in protocol_fields().items()):
        raise ValueError('Prospective protocol differs from the exact fixed v1 contract.')
    if freeze.get('format') != 'ablatrix-fresh-validation-candidate-freeze-v1' or freeze.get('frozen') is not True or freeze.get('freshInputRead') is not False:
        raise ValueError('Invalid candidate freeze.')
    if freeze.get('protocolFileSha256') != p['fileSha256'] or freeze.get('historyInventoryFileSha256') != h['fileSha256']:
        raise ValueError('Protocol/history raw bytes differ from freeze.')
    if freeze.get('candidate') != protocol['candidate'] or freeze.get('implementationSha256') != protocol.get('implementationSha256') or set(freeze['implementationSha256']) != set(code_paths(root)):
        raise ValueError('Exact candidate/code binding is required.')
    for name, expected in freeze['implementationSha256'].items():
        if sha(canonical_file(root, name).read_bytes()) != expected:
            raise ValueError('Prospectively frozen code changed: ' + name)
    if set(history.get('artifactSha256', {})) != set(historical_paths(root)):
        raise ValueError('Complete historical manifest changed or omitted a tracked public record; freeze a new inventory before any fresh read.')
    if not REQUIRED_HISTORY <= set(history.get('artifactSha256', {})):
        raise ValueError('Historical inventory cannot omit old studies or frozen public replay inputs.')
    if inventory(root, history['artifactSha256']) != history or protocol.get('historyInventorySha256') != history['inventorySha256']:
        raise ValueError('Raw-bound protected history cannot be reproduced exactly.')
    return {'protocol': p, 'freeze': f, 'history': h}

def qualify(root, frozen, path):
    q = read(root, path)
    d = q['document']
    # This check deliberately precedes ANY pool read/stat/hash, even on replay.
    if d.get('format') != 'ablatrix-fresh-validation-source-screening-qualification-v1' or d.get('status') != 'reviewed_for_source_only_screening':
        raise ValueError('Fresh selection stopped: exact protocol/code/history review is pending; fresh packet not read.')
    for key, item in [('protocolFileSha256', 'protocol'), ('candidateFreezeFileSha256', 'freeze'), ('historyInventoryFileSha256', 'history')]:
        if d.get(key) != frozen[item]['fileSha256']:
            raise ValueError('Qualification must bind exact reviewed raw artifact bytes.')
    if not isinstance(d.get('reviewer'), str) or not d['reviewer'].strip() or d.get('provenance') not in {'source_checked_human', 'independent_code_review_ai'} or d.get('freshInputsInspectedBeforeReview') is not False or not DIGEST.fullmatch(d.get('poolFileSha256') or '') or not d.get('reviewEvidence'):
        raise ValueError('Qualification needs named review provenance/evidence and one finite source-only pool commitment.')
    created = datetime.datetime.fromisoformat(frozen['protocol']['document']['createdAt'])
    reviewed = datetime.datetime.fromisoformat(d['reviewedAt'])
    if reviewed.tzinfo is None or reviewed < created:
        raise ValueError('Review must postdate the prospective freeze.')
    return q

def source_cases(document):
    if set(document) != {'format', 'cases'} or document['format'] != 'ablatrix-fresh-source-only-pool-v1' or len(document['cases']) != 24:
        raise ValueError('Finite pool must contain exactly24 source-only packets; no outcome fields.')
    result = document['cases']
    if len({c['id'] for c in result}) != 24:
        raise ValueError('The entire screened case denominator requires distinct IDs.')
    for case in result:
        if set(case) != {'id', 'product', 'question', 'sources', 'sourcePoolSha256'} or set(case['product']) != {'id', 'title'} or not ASIN.fullmatch(case['product']['id']) or not case['product']['title'].strip() or not case['question'].strip() or not 1 <= len(case['sources']) <= 128:
            raise ValueError('Malformed literal source-only packet.')
        if len({s['id'] for s in case['sources']}) != len(case['sources']) or case['sourcePoolSha256'] != sha(compact(case['sources'])):
            raise ValueError('Literal source-pool identity mismatch.')
        for s in case['sources']:
            if set(s) != {'id', 'label', 'text', 'originalQuestion', 'reference', 'sha256'} or not isinstance(s['text'], str) or not 0 < len(s['text'].encode('utf-16-le')) // 2 <= 1500 or '\0' in s['text'] or not s['id'] or not s['label'] or not isinstance(s['reference'], str) or not (s['originalQuestion'] is None or isinstance(s['originalQuestion'], str)):
                raise ValueError('Only bounded literal source body and original customer-question scope are permitted.')
            if s['sha256'] != sha(compact([s[k] for k in ('id', 'label', 'text', 'originalQuestion', 'reference')])):
                raise ValueError('Literal source record changed.')
    return result

def screen_document(pool, frozen, qualification):
    cases = source_cases(pool['document'])
    history = frozen['history']['document']
    protected_products = set(history['productIds']); protected_models = set(history['modelIdentifiers'])
    titles = list(history['canonicalFamilyTitles']); packets = set(history['sourcePacketFingerprints'])
    order = sorted(cases, key=lambda c: (sha(compact([SEED, c['product']['id'], c['question'], c['sourcePoolSha256']])), c['id']))
    # Integrate the genuine body+original-question guard over the WHOLE input
    # deck, not merely accepted rows. An earlier excluded packet still exposed it.
    overlap = packet.verify(order)
    overlap_ids = {r['caseId'] for r in overlap['overlaps']}
    decisions = []
    for case in order:
        pid, title = case['product']['id'], case['product']['title']
        ids = models(title + ' ' + case['question'] + ' ' + ' '.join(s['text'] + ' ' + (s['originalQuestion'] or '') for s in case['sources']))
        fingerprints = {fp for s in case['sources'] for fp in (packet.fingerprint(s), scoped_fingerprint(s))}
        reasons = []
        if pid in protected_products: reasons.append('historical_or_within_pool_product')
        if any(family_conflict(title, other) for other in titles): reasons.append('historical_or_within_pool_family')
        if model_conflict(ids, protected_models): reasons.append('historical_or_within_pool_model')
        if fingerprints & packets: reasons.append('historical_or_within_pool_body_and_original_question')
        if case['id'] in overlap_ids: reasons.append('within_deck_packet_guard')
        decisions.append({'caseId': case['id'], 'eligible': not reasons, 'reasons': reasons, 'packet': case})
        # All viewed packets enter protection, not only successful candidates.
        protected_products.add(pid); titles.append(family(title)); protected_models.update(ids); packets.update(fingerprints)
    body = {'format': 'ablatrix-fresh-validation-screening-v1', 'poolFileSha256': pool['fileSha256'],
            'protocolFileSha256': frozen['protocol']['fileSha256'], 'candidateFreezeFileSha256': frozen['freeze']['fileSha256'],
            'historyInventoryFileSha256': frozen['history']['fileSha256'], 'qualificationFileSha256': qualification['fileSha256'],
            'screeningDenominator': 24, 'acceptedCaseIds': [r['caseId'] for r in decisions if r['eligible']],
            'decisions': decisions, 'packetGuard': overlap, 'candidateContextInspected': False,
            'generatedAnswersInspected': False, 'providerCalls': 0, 'paidExecutionAuthorized': False}
    return {**body, 'screeningSha256': seal(body)}

def load_screening(root, directory, qualification_path, pool_path, saved_path=None):
    frozen = verify_freeze(root, directory)
    qualification = qualify(root, frozen, qualification_path)
    pool = read(root, pool_path)
    if pool['fileSha256'] != qualification['document']['poolFileSha256']:
        raise ValueError('Committed finite pool bytes changed; stop without replacement.')
    expected = screen_document(pool, frozen, qualification)
    saved = read(root, saved_path) if saved_path else None
    if saved and saved['document'] != expected:
        raise ValueError('Saved screening cannot be reproduced from exact reviewed history/pool/code.')
    bindings = {v['path']: v['fileSha256'] for v in [*frozen.values(), qualification, pool, *([saved] if saved else [])]}
    return frozen, qualification, pool, expected, bindings

def finalize_document(screening, baseline, review, baseline_file_sha=None, review_file_sha=None):
    """Freeze eligibility from baseline+complete sources before candidate scoring."""
    if baseline.get('format') != 'ablatrix-fresh-validation-baseline-v1' or baseline.get('screeningSha256') != screening['screeningSha256'] or baseline.get('candidateContextInspected') is not False:
        raise ValueError('Use only current baseline, bound to the complete screening denominator.')
    accepted = [r['packet'] for r in screening['decisions'] if r['eligible']]
    if [r['caseId'] for r in baseline.get('results', [])] != [c['id'] for c in accepted]:
        raise ValueError('Baseline denominator must retain every accepted screening packet.')
    if review.get('format') != 'ablatrix-fresh-validation-source-review-v1' or review.get('screeningSha256') != screening['screeningSha256'] or review.get('baselineSha256') != (baseline_file_sha or seal(baseline)) or review.get('candidateContextInspected') is not False or review.get('answerOutputsInspected') is not False or review.get('provenance') not in {'source_checked_human', 'independent_source_review_ai'} or not review.get('reviewer'):
        raise ValueError('Complete independent baseline/full-source review must precede candidate inspection.')
    if [r['caseId'] for r in review.get('cases', [])] != [r['caseId'] for r in screening['decisions']]:
        raise ValueError('Review must retain all24 screened rows, including exclusions/uncertainties.')
    by_review = {r['caseId']: r for r in review['cases']}; by_baseline = {r['caseId']: r for r in baseline['results']}
    for decision in screening['decisions']:
        c, assessed = decision['packet'], by_review[decision['caseId']]
        if assessed.get('sourcePoolSha256') != c['sourcePoolSha256']:
            raise ValueError('Source review must bind exact complete packet and original questions.')
        if not decision['eligible']:
            if assessed.get('status') != 'excluded_by_disjointness':
                raise ValueError('Excluded screening rows must stay explicitly excluded.')
            continue
        b = by_baseline[c['id']]
        for key in ('sourceScopeReviewed', 'originalQuestionsReviewed', 'familySeparationReviewed', 'titleAndBaselineReviewed', 'referenceSufficiencyReviewed'):
            if assessed.get(key) is not True: raise ValueError('Independent review incomplete: ' + key)
        if assessed.get('baselineContextSha256') != sha(compact(b['baseline'])) or not assessed.get('tags') or not set(assessed['tags']) <= TAGS or len(set(assessed['tags'])) != len(assessed['tags']) or not isinstance(assessed.get('unknowns'), list) or not assessed.get('applicabilityNotes'):
            raise ValueError('Incomplete source-only semantic assessment.')
        refs, facts = assessed.get('referenceSourceIds', []), assessed.get('designatedFacts', [])
        if not 1 <= len(refs) <= 8 or len(set(refs)) != len(refs) or not facts or any(not any(s['id'] == ref for s in c['sources']) for ref in refs):
            raise ValueError('Reference requires literal source IDs and scoped designated units.')
        for fact in facts:
            if not fact.get('fact') or not fact.get('qualification') or not fact.get('applicability') or not isinstance(fact.get('quote'), str) or len(fact['quote'].strip()) < 5 or not fact.get('sourceIds'):
                raise ValueError('Every designated unit needs scope, literal quote and qualifications.')
            for source_id in fact['sourceIds']:
                source = next((s for s in c['sources'] if s['id'] == source_id), None)
                if source is None or fact['quote'] not in source['text'] or source_id not in refs:
                    raise ValueError('Reference must include each exact designated source, with original CQA scope.')
        def delivered(fact):
            return any(p['id'] in fact['sourceIds'] and fact['quote'] in p['text'] and any(s['id'] == p['id'] and s['text'] == p['text'] and s['originalQuestion'] == p.get('originalQuestion') for s in c['sources']) for p in b['baseline'])
        if 'supported_gap' in assessed['tags'] and (assessed.get('noEquivalentFactInBaseline') is not True or assessed.get('baselineComplete') is not False or all(delivered(f) for f in facts)):
            raise ValueError('Gap eligibility requires a scoped missing unit plus semantic baseline/full-source checking, never candidate success.')
        if 'baseline_complete_control' in assessed['tags'] and (assessed.get('baselineComplete') is not True or not all(delivered(f) for f in facts)):
            raise ValueError('Complete controls require independently assessed completeness and every scoped designated unit in baseline.')
        if 'conflicting_reports' in assessed['tags'] and (len({sid for f in facts for sid in f['sourceIds']}) < 2 or not assessed.get('conflictNotes')):
            raise ValueError('Conflicting-report cases need separately scoped reports and conditions.')
        if 'insufficient_evidence' in assessed['tags'] and (not assessed['unknowns'] or not assessed.get('insufficiencyNotes')):
            raise ValueError('Insufficient evidence needs preserved unknowns and explicit limits.')
    selected = []
    missing = {}
    for tag, count in MINIMA.items():
        existing = sum(tag in by_review[cid]['tags'] for cid in selected)
        for c in accepted:
            if existing >= count: break
            if c['id'] not in selected and tag in by_review[c['id']]['tags']:
                selected.append(c['id']); existing += 1
        if existing < count: missing[tag] = count - existing
    for c in accepted:
        if len(selected) >= 8: break
        if c['id'] not in selected: selected.append(c['id'])
    # Present selected cases in frozen screening order, not quota traversal order.
    selected = [c['id'] for c in accepted if c['id'] in selected]
    stop = 'source_only_minima_unsatisfied' if missing or len(selected) != 8 else None
    return {'format': 'ablatrix-fresh-validation-selection-v1', 'screeningSha256': screening['screeningSha256'],
            'baselineSha256': baseline_file_sha or seal(baseline), 'sourceReviewSha256': review_file_sha or seal(review), 'screeningDenominator': 24,
            'selectedDenominator': len(selected), 'selectedCaseIds': selected, 'missingMinima': missing,
            'stopReason': stop, 'candidateContextInspected': False, 'candidateMissesRetained': True,
            'screenedCaseIds': [r['caseId'] for r in screening['decisions']], 'providerCalls': 0, 'paidExecutionAuthorized': False}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='mode', required=True)
    freeze = sub.add_parser('freeze'); freeze.add_argument('--out-dir', required=True)
    for mode in ('verify', 'screen', 'verify-screen', 'select'):
        p = sub.add_parser(mode); p.add_argument('--freeze-dir', required=True)
        if mode != 'verify':
            for flag in ('qualification', 'pool'): p.add_argument('--' + flag, required=True)
        if mode in {'verify-screen', 'select'}: p.add_argument('--screening', required=True)
        if mode == 'select':
            for flag in ('baseline', 'review'): p.add_argument('--' + flag, required=True)
        if mode in {'screen', 'select'}: p.add_argument('--out', required=True)
    args = parser.parse_args()
    try:
        if args.mode == 'freeze': result = create_freeze(ROOT, args.out_dir)
        elif args.mode == 'verify':
            f = verify_freeze(ROOT, args.freeze_dir)
            result = {'mode': 'verified_prospective_no_fresh_reads', 'history': f['history']['document']['observations'], 'freshInputReads': 0, 'providerCalls': 0}
        else:
            f, q, pool, screened, bindings = load_screening(ROOT, args.freeze_dir, args.qualification, args.pool, getattr(args, 'screening', None))
            if args.mode == 'select':
                baseline, review = read(ROOT, args.baseline), read(ROOT, args.review)
                checked = json.loads(subprocess.check_output(['node', '--import', 'tsx', 'scripts/fresh-validation-contexts-v1.ts', '--verify-baseline', '--freeze-dir', args.freeze_dir, '--qualification', args.qualification, '--pool', args.pool, '--screening', args.screening, '--baseline', args.baseline], cwd=ROOT, stderr=subprocess.PIPE))
                if checked.get('baselineFileSha256') != baseline['fileSha256'] or checked.get('screeningFileSha256') != bindings[args.screening]:
                    raise ValueError('Baseline/screening snapshot changed during actual saved-stage verification.')
                result = finalize_document(screened, baseline['document'], review['document'], baseline['fileSha256'], review['fileSha256'])
                result['artifactSha256'] = {**bindings, args.baseline: baseline['fileSha256'], args.review: review['fileSha256']}
                bindings.update(result['artifactSha256'])
                result['selectionSha256'] = seal(result)
            else: result = screened
            if args.mode in {'screen', 'select'}: write_new(pathlib.Path(args.out), result)
            result = {'mode': args.mode, 'screeningDenominator': 24, 'accepted': len(screened['acceptedCaseIds']), 'stopReason': result.get('stopReason'), 'artifactSha256': bindings, 'providerCalls': 0, 'paidExecutionAuthorized': False}
        print(json.dumps(result, indent=2))
    except (ValueError, KeyError, TypeError, OSError, json.JSONDecodeError, subprocess.CalledProcessError) as error:
        parser.exit(1, 'Fresh validation stopped: ' + str(error) + '\n')

if __name__ == '__main__': main()
