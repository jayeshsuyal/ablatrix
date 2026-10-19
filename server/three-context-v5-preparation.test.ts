import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { textHash } from './product-corpus.ts';
import { SEMANTIC_SUPPLEMENT_V5 } from './semantic-supplement-v5.ts';
import { loadV5DevelopmentPreparationInputs } from '../scripts/prepare-three-context-v5.ts';
type Json = Record<string, any>;
const encode = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'ablatrix-v5-preparation-SYNTHETIC-'))), root = join(base, 'repository'), outside = join(base, 'outside');
  mkdirSync(join(root, '.data'), { recursive: true }); mkdirSync(outside);
  const write = (path: string, body: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), body); };
  write('candidate.ts', '// SYNTHETIC candidate fixture\n'); write('input.json', '{"SYNTHETIC":true}\n');
  const freeze: Json = { format: 'ablatrix-semantic-supplement-v5-development-freeze-v1', candidate: structuredClone(SEMANTIC_SUPPLEMENT_V5), codeSha256: { 'candidate.ts': textHash(readFileSync(join(root, 'candidate.ts'), 'utf8')) }, inputSha256: { 'input.json': textHash(readFileSync(join(root, 'input.json'), 'utf8')) }, providerCalls: 0, qualityClaimEligible: false };
  const saved: Json = { format: 'ablatrix-semantic-supplement-v5-development-comparison-v1', candidate: structuredClone(SEMANTIC_SUPPLEMENT_V5), freeze: { path: 'freeze.json', fileSha256: '' }, providerCalls: 0, generatedAnswers: 0, qualityClaimEligible: false, results: [] };
  const save = () => { const bytes = encode(freeze); write('freeze.json', bytes); saved.freeze.fileSha256 = textHash(bytes); write('saved.json', encode(saved)); };
  save(); const output = join(root, '.data', 'new-preparation.json');
  return { root, outside, freeze, saved, output, write, save, load: () => loadV5DevelopmentPreparationInputs('saved.json', output, root), cleanup: () => rmSync(base, { recursive: true, force: true }) };
}
test('v5 preparation input loader accepts exact frozen contracts and checks every raw byte binding without creating output', () => {
  const f = fixture();
  try {
    const loaded = f.load(); assert.deepEqual(loaded.saved.candidate, SEMANTIC_SUPPLEMENT_V5); assert.equal(loaded.saved.generatedAnswers, 0); assert.equal(existsSync(f.output), false);
    f.write('input.json', '{ "SYNTHETIC": true }\n'); assert.throws(f.load, /Frozen candidate changed/); assert.equal(existsSync(f.output), false);
  } finally { f.cleanup(); }
});
test('v5 preparation rejects symlink/outside inputs before parsing them and creates no output directories', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.outside, 'not-json'), 'SYNTHETIC invalid JSON'); symlinkSync(join(f.outside, 'not-json'), join(f.root, 'linked-input.json'));
    assert.throws(() => loadV5DevelopmentPreparationInputs('linked-input.json', f.output, f.root), /canonical repository regular files/);
    assert.throws(() => loadV5DevelopmentPreparationInputs('../outside/not-json', f.output, f.root), /canonical repository-relative input path/);
    symlinkSync(f.outside, join(f.root, '.data', 'linked'));
    const escapedOutput = join(f.root, '.data', 'linked', 'created-outside', 'preparation.json');
    assert.throws(() => loadV5DevelopmentPreparationInputs('saved.json', escapedOutput, f.root)); assert.equal(existsSync(join(f.outside, 'created-outside')), false);
    assert.throws(() => loadV5DevelopmentPreparationInputs('saved.json', join(f.root, '.data', 'linked', 'preparation.json'), f.root), /already exist and be canonical/);
    writeFileSync(f.output, 'SYNTHETIC sentinel'); assert.throws(f.load, /new repository .data/); assert.equal(readFileSync(f.output, 'utf8'), 'SYNTHETIC sentinel');
  } finally { f.cleanup(); }
});
test('v5 preparation validates all declared paths before any declared-body hash check', () => {
  for (const badPath of ['../outside/not-json', '/private/tmp/not-json']) {
    const f = fixture();
    try {
      // A body hash failure would happen first if the implementation read while
      // walking entries instead of validating the entire path set in advance.
      f.freeze.codeSha256['candidate.ts'] = '0'.repeat(64); f.freeze.inputSha256[badPath] = '1'.repeat(64); f.save();
      assert.throws(f.load, /canonical repository-relative input path/); assert.equal(existsSync(f.output), false);
    } finally { f.cleanup(); }
  }
  const f = fixture();
  try { f.saved.freeze.path = '../outside/not-json'; f.save(); assert.throws(f.load, /canonical repository-relative input path/); }
  finally { f.cleanup(); }
});
test('v5 preparation rejects changed candidate, freeze format and paid/generated/quality authority metadata', () => {
  const mutations: ((f: ReturnType<typeof fixture>) => void)[] = [
    f => { f.saved.format = 'wrong'; }, f => { f.saved.candidate.maxAdditions = 4; }, f => { f.saved.providerCalls = 1; },
    f => { f.saved.generatedAnswers = 1; }, f => { delete f.saved.generatedAnswers; }, f => { f.saved.qualityClaimEligible = true; },
    f => { f.saved.paidExecutionAuthorized = true; }, f => { f.saved.activationAllowed = true; }, f => { f.freeze.format = 'wrong'; },
    f => { f.freeze.candidate.contract = 'wrong'; }, f => { f.freeze.providerCalls = 1; }, f => { f.freeze.qualityClaimEligible = true; },
    f => { f.freeze.paidExecutionAuthorized = true; }, f => { f.freeze.activationAllowed = true; }
  ];
  for (const mutate of mutations) {
    const f = fixture(); try { mutate(f); f.save(); assert.throws(f.load); assert.equal(existsSync(f.output), false); }
    finally { f.cleanup(); }
  }
});
