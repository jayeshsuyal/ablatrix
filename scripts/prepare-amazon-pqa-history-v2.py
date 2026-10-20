#!/usr/bin/env python3
"""Native APQA history: replay the consumed frame before a separate fresh frame."""
import argparse
import hashlib
import importlib.util
import json
import pathlib
import subprocess
import sys

ROOT=pathlib.Path(__file__).resolve().parents[1]
FIELDS=('productIds','canonicalFamilyTitles','modelIdentifiers','sourcePacketFingerprints','sourceBodyFingerprints')


def module(path,name):
    spec=importlib.util.spec_from_file_location(name,path);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value


def combine(base,failed,projection):
    assert base.get('completeHistoricalUnion') is True
    assert failed.get('format')=='ablatrix-amazon-pqa-semantic-access-failure-v1' and failed.get('status')=='source_parse_failed'
    assert failed.get('wholePrefixConsumed') is True and failed.get('eligiblePackets')==0 and failed.get('providerCalls')==0
    assert projection.get('format')=='ablatrix-amazon-pqa-exposed-prefix-replay-v2' and projection.get('developmentOnly') is True
    assert projection.get('completeRowsMapped') is True and projection.get('sourceEligibilityPassed') is False
    assert type(projection.get('completePrefixMapping')) is bool and type(projection.get('unresolvedBoundary')) is bool
    assert projection['completePrefixMapping'] is not projection['unresolvedBoundary']
    assert projection.get('candidateContextInspected') is False and projection.get('answerOutputsInspected') is False and projection.get('providerCalls')==0
    prefixes=projection['sourcePrefixes'];assert len(prefixes)==1
    p=prefixes[0];old=failed['opaquePrefixObjects'];assert len(old)==1
    assert p['key']==old[0]['key'] and p['versionId']==old[0]['versionId'] and p['sha256']==old[0]['rawSha256'] and p['range']==old[0]['range']
    assert p['range']=={'start':0,'endInclusive':16*1024*1024-1}
    assert isinstance(projection.get('semanticRowsInspected'),int) and 0<projection['semanticRowsInspected']<=100000
    assert projection['normalization']['pythonVersion']==base['normalization']['pythonVersion']
    assert projection['normalization']['unicodeVersion']==base['normalization']['unicodeVersion']
    union={key:sorted(set(base[key])|set(failed['consumedExposure'][key])|set(projection['consumedExposure'][key])) for key in FIELDS}
    assert all(isinstance(v,str) and v for key in FIELDS for v in union[key])
    return {**union,'priorConsumedSourcePrefixes':prefixes,'consumedSourcePrefixes':prefixes,
            'priorConsumedCompleteRowsMappingVerified':True,
            'priorConsumedPrefixMappingVerified':projection['completePrefixMapping'],
            'unresolvedPriorSemanticExposure':projection['unresolvedBoundary'],
            'withheldAggregateFingerprints':sorted(set(projection.get('withheldAggregateFingerprints',[])))}


def build(base_name,failure_name,projection_name,root=ROOT):
    h1=module(root/'scripts/prepare-amazon-pqa-history-v1.py','apqa_history_v1_for_v2')
    v1=module(root/'scripts/prepare-fresh-validation-v1.py','apqa_prior_history_reader')
    base,failure,projection=[v1.read(root,n) for n in (base_name,failure_name,projection_name)]
    d=base['document']
    reconstructed=h1.build(root,d['priorFreezeDirectory'],d['consumedExposurePath'],d['metadataExposurePath'],d.get('additionalExposurePaths',[]))
    assert reconstructed==d,'The complete original protected history must reconstruct.'
    command=['node','--import','tsx','scripts/amazon-pqa-validation-v2.ts','--verify-exposed','--input',projection_name]
    run=subprocess.run(command,cwd=root,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=120,check=False)
    assert run.returncode==0,'Consumed native-prefix mapping failed exact code/byte replay.'
    proof=json.loads(run.stdout)
    assert proof.get('format')=='ablatrix-amazon-pqa-exposed-prefix-proof-v2' and proof.get('projectionFileSha256')==projection['fileSha256']
    union=combine(base['document'],failure['document'],projection['document'])
    body={'format':'ablatrix-amazon-pqa-protected-history-v2','completeHistoricalUnion':True,
          'contracts':{'baseHistory':{'path':base_name,'fileSha256':base['fileSha256']},'failedAttempt':{'path':failure_name,'fileSha256':failure['fileSha256']},
                       'consumedPrefixProjection':{'path':projection_name,'fileSha256':projection['fileSha256']}},
          **union,'normalization':d['normalization'],'incidentalUnknownFamilyProductIds':d['incidentalUnknownFamilyProductIds'],
          'priorPublicArtifactSha256':d['priorPublicArtifactSha256'],'priorEmbeddedArtifactSha256':d['priorEmbeddedArtifactSha256'],
          'inputArtifacts':[{k:x[k] for k in ('path','fileSha256')} for x in (base,failure,projection)],
          'originalFailedAttemptPreserved':True,'exposedReplayEstablishesFreshness':False,'candidateOutputsUsed':False,
          'providerCalls':0,'humanSourceCheckedAnswers':0,'qualityClaimEligible':False,'activationAuthorized':False}
    return {**body,'historySha256':v1.seal(body)}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base');parser.add_argument('--failure');parser.add_argument('--projection');parser.add_argument('--out');parser.add_argument('--verify')
    args=parser.parse_args();v1=module(ROOT/'scripts/prepare-fresh-validation-v1.py','apqa_v2_cli_reader')
    if args.verify:
        artifact=v1.read(ROOT,args.verify);saved=artifact['document'];c=saved['contracts']
        current=build(c['baseHistory']['path'],c['failedAttempt']['path'],c['consumedPrefixProjection']['path'])
        assert saved==current,'Native APQA history changed or omitted consumed source exposure.'
        result={'format':'ablatrix-amazon-pqa-history-proof-v2','historyFileSha256':artifact['fileSha256'],
                'counts':{key:len(saved[key]) for key in FIELDS},'unresolvedPriorSemanticExposure':saved['unresolvedPriorSemanticExposure'],'providerCalls':0}
    else:
        assert all((args.base,args.failure,args.projection,args.out)),'Supply original history, failed attempt, native exposed projection and new output.'
        value=build(args.base,args.failure,args.projection);v1.write_new(args.out,value);pathlib.Path(args.out).chmod(0o600)
        result={'format':'ablatrix-amazon-pqa-history-result-v2','output':args.out,'fileSha256':hashlib.sha256(pathlib.Path(args.out).read_bytes()).hexdigest(),
                'counts':{key:len(value[key]) for key in FIELDS},'unresolvedPriorSemanticExposure':value['unresolvedPriorSemanticExposure'],'providerCalls':0}
    print(json.dumps(result,indent=2))


if __name__=='__main__':
    try:main()
    except (ValueError,OSError,AssertionError,KeyError,TypeError) as error:print('APQA native history: '+str(error),file=sys.stderr);sys.exit(1)
