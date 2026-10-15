import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync, type Stats } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';

export type QualificationJournalBinding = {
  planSha256: string; datasetSha256: string; ledgerPath: string; claimDirectory: string; checkpointPath: string; reportPath: string;
  transportProvenance: 'live_router' | 'mocked_mechanics_only';
};
export type QualificationJournalEvent = { kind: 'intent' | 'slot_started' | 'slot_reserved' | 'slot_observed' | 'stopped' | 'finished'; [key: string]: unknown };
export type QualificationJournalPaths = Readonly<{ ledgerPath: string; claimPath: string; checkpointPath: string; reportPath: string }>;
type Authority = 'operator_approved_bounded_qualification' | 'mocked_mechanics_only';
type Common = { planSha256: string; datasetSha256: string; transportProvenance: QualificationJournalBinding['transportProvenance']; authority: Authority };
export type QualificationJournalRecord = Common & QualificationJournalEvent & {
  format: 'grader-qualification-checkpoint-v1'; sequence: number; previousSha256: string; createdAt: string; sha256: string;
};
export type QualificationJournalAnchor = Common & {
  format: 'grader-qualification-cohort-claim-v1'; sequence: number; previousSha256: string;
  ledgerPath: string; claimPath: string; checkpointPath: string; reportPath: string; recordCount: number; tailSha256: string; checkpointBytes: number; createdAt: string; sha256: string;
};
export type QualificationJournalHandle = Readonly<{ paths: QualificationJournalPaths }>;
export type QualificationJournalInspection = { paths: QualificationJournalPaths; records: QualificationJournalRecord[]; anchors: QualificationJournalAnchor[] };

const ZERO = '0'.repeat(64), DIGEST = /^[a-f0-9]{64}$/;
const MAX_LINE_BYTES = 256 * 1024, MAX_CHECKPOINT_BYTES = 32 * 1024 * 1024, MAX_ANCHOR_BYTES = 4 * 1024 * 1024, MAX_RECORDS = 1024;
const eventKinds = new Set(['intent', 'slot_started', 'slot_reserved', 'slot_observed', 'stopped', 'finished']);
const reserved = new Set(['format', 'sequence', 'previousSha256', 'planSha256', 'datasetSha256', 'transportProvenance', 'authority', 'createdAt', 'sha256']);
type Identity = { dev: number; ino: number };
type State = { binding: QualificationJournalBinding; paths: QualificationJournalPaths; common: Common; records: QualificationJournalRecord[]; anchors: QualificationJournalAnchor[]; checkpointIdentity: Identity; claimIdentity: Identity };
const handles = new WeakMap<QualificationJournalHandle, State>();

function plainJson(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || seen.has(value)) throw new Error('Qualification journal accepts finite, acyclic plain JSON values only.');
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) throw new Error('Qualification journal accepts plain JSON objects only.');
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length || Object.getOwnPropertySymbols(value).length || Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !('value' in d))) throw new Error('Qualification journal arrays must be dense plain JSON arrays.');
    for (const item of value) plainJson(item, seen);
  } else {
    if (Object.getOwnPropertySymbols(value).length || Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !('value' in d) || !d.enumerable)) throw new Error('Qualification journal objects cannot contain accessors or hidden fields.');
    for (const item of Object.values(value)) plainJson(item, seen);
  }
  seen.delete(value);
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
function hash(value: unknown) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function line(value: unknown) { return `${JSON.stringify(value)}\n`; }
function identity(stat: Stats): Identity { return { dev: stat.dev, ino: stat.ino }; }
function sameIdentity(a: Identity, b: Identity) { return a.dev === b.dev && a.ino === b.ino; }
function optionalStat(path: string): Stats | undefined {
  try { return lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

/** Reject lexical aliases and every symlink component, including dangling links.
 * Missing suffixes are allowed for exclusive future outputs; this is not a mkdir. */
function canonicalPath(path: string) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path || path === parse(path).root) throw new Error('Qualification paths must be normalized absolute file or directory paths.');
  const components: string[] = [];
  let cursor = path;
  while (cursor !== parse(cursor).root) { components.push(cursor); cursor = dirname(cursor); }
  for (const item of components.reverse()) {
    const stat = optionalStat(item);
    if (!stat) continue;
    if (stat.isSymbolicLink() || realpathSync(item) !== item || item !== path && !stat.isDirectory()) throw new Error('Qualification paths cannot contain symlinks, aliases or non-directory ancestors.');
  }
  return path;
}
function ensureDirectory(path: string) {
  canonicalPath(path);
  const missing: string[] = [];
  let cursor = path;
  while (!optionalStat(cursor)) { missing.push(cursor); cursor = dirname(cursor); }
  for (const item of missing.reverse()) {
    try { mkdirSync(item, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    canonicalPath(item);
    if (!lstatSync(item).isDirectory()) throw new Error('Qualification output parent is not a directory.');
    syncDirectory(item);
  }
  canonicalPath(path);
  if (!lstatSync(path).isDirectory()) throw new Error('Qualification output parent is not a directory.');
}
function syncDirectory(path: string) {
  const parent = dirname(path), fd = openSync(parent, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { if (!fstatSync(fd).isDirectory()) throw new Error('Qualification parent was replaced.'); fsyncSync(fd); } finally { closeSync(fd); }
}
function frozenBinding(input: QualificationJournalBinding) {
  if (!DIGEST.test(input.planSha256) || !DIGEST.test(input.datasetSha256) || !['live_router', 'mocked_mechanics_only'].includes(input.transportProvenance)) throw new Error('Qualification journal requires exact plan, dataset and transport identities.');
  const binding: QualificationJournalBinding = { planSha256: input.planSha256, datasetSha256: input.datasetSha256, ledgerPath: canonicalPath(input.ledgerPath), claimDirectory: canonicalPath(input.claimDirectory), checkpointPath: canonicalPath(input.checkpointPath), reportPath: canonicalPath(input.reportPath), transportProvenance: input.transportProvenance };
  const paths = Object.freeze({ ledgerPath: binding.ledgerPath, claimPath: join(binding.claimDirectory, `${binding.datasetSha256}.claim.jsonl`), checkpointPath: binding.checkpointPath, reportPath: binding.reportPath });
  canonicalPath(paths.claimPath);
  const allPaths = Object.values(paths);
  if (new Set(allPaths).size !== 4 || allPaths.some(p => p === binding.claimDirectory) || allPaths.some(a => allPaths.some(b => a !== b && b.startsWith(`${a}/`)))) throw new Error('Qualification ledger, cohort claim, checkpoint and report must be separate files.');
  const common: Common = { planSha256: binding.planSha256, datasetSha256: binding.datasetSha256, transportProvenance: binding.transportProvenance, authority: binding.transportProvenance === 'live_router' ? 'operator_approved_bounded_qualification' : 'mocked_mechanics_only' };
  return { binding, paths, common };
}
function exclusive(path: string, content: string, mode = 0o600) {
  canonicalPath(path);
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1) throw new Error('Qualification exclusive output is not a regular private file.');
    writeFileSync(fd, content); fsyncSync(fd);
    return identity(stat);
  } finally { closeSync(fd); syncDirectory(path); }
}
function readBounded<T>(path: string, maxBytes: number, allowEmpty = false): { values: T[]; bytes: number; identity: Identity } {
  canonicalPath(path);
  const before = lstatSync(path), fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || !sameIdentity(before, stat) || stat.size > maxBytes || (!allowEmpty && stat.size < 1)) throw new Error('Qualification journal is missing, replaced, linked or outside its size bound.');
    const bytes = readFileSync(fd);
    if (bytes.length !== stat.size || !sameIdentity(stat, lstatSync(path))) throw new Error('Qualification journal changed while reading.');
    if (allowEmpty && !bytes.length) return { values: [], bytes: 0, identity: identity(stat) };
    const content = bytes.toString('utf8');
    if (!Buffer.from(content).equals(bytes) || !content.endsWith('\n') || content.includes('\r')) throw new Error('Qualification journal has an incomplete or altered tail.');
    const lines = content.slice(0, -1).split('\n');
    if (lines.length > MAX_RECORDS + 1 || lines.some(item => Buffer.byteLength(item) > MAX_LINE_BYTES)) throw new Error('Qualification journal exceeds its record bound.');
    const values = lines.map(item => {
      const value: unknown = JSON.parse(item); plainJson(value);
      if (!value || Array.isArray(value) || typeof value !== 'object' || JSON.stringify(value) !== item) throw new Error('Qualification journal record encoding was changed.');
      return value as T;
    });
    return { values, bytes: bytes.length, identity: identity(stat) };
  } finally { closeSync(fd); }
}
function append(path: string, value: unknown, expected: Identity, maxBytes: number) {
  canonicalPath(path);
  const content = line(value), fd = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || !sameIdentity(stat, expected) || stat.size + Buffer.byteLength(content) > maxBytes || Buffer.byteLength(content) > MAX_LINE_BYTES) throw new Error('Qualification journal changed or exceeded its append bound.');
    writeFileSync(fd, content); fsyncSync(fd);
  } finally { closeSync(fd); }
}
function validDate(value: unknown) { return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function anchorBody(state: Pick<State, 'common' | 'paths' | 'records' | 'anchors'>): Omit<QualificationJournalAnchor, 'sha256'> {
  return { format: 'grader-qualification-cohort-claim-v1', ...state.common, sequence: state.anchors.length, previousSha256: state.anchors.at(-1)?.sha256 ?? ZERO,
    ledgerPath: state.paths.ledgerPath, claimPath: state.paths.claimPath, checkpointPath: state.paths.checkpointPath, reportPath: state.paths.reportPath,
    recordCount: state.records.length, tailSha256: state.records.at(-1)?.sha256 ?? ZERO, checkpointBytes: state.records.reduce((n, record) => n + Buffer.byteLength(line(record)), 0), createdAt: new Date().toISOString() };
}

/** Dataset-wide exclusive consumption happens before provider construction. A
 * surviving claim OR checkpoint permanently prevents dispatch/resumption; this
 * helper does not authenticate operator approval or provider provenance. */
export function createQualificationJournal(input: QualificationJournalBinding): QualificationJournalHandle {
  const frozen = frozenBinding(input);
  for (const path of [frozen.paths.claimPath, frozen.paths.checkpointPath, frozen.paths.reportPath]) if (optionalStat(path)) throw new Error('Qualification cohort or output is already consumed; execution cannot resume or retry.');
  ensureDirectory(frozen.binding.claimDirectory); ensureDirectory(dirname(frozen.paths.checkpointPath)); ensureDirectory(dirname(frozen.paths.reportPath));
  const initialBody = anchorBody({ ...frozen, records: [], anchors: [] }), initial = { ...initialBody, sha256: hash(initialBody) };
  const claimIdentity = exclusive(frozen.paths.claimPath, line(initial));
  // Never remove a claim if checkpoint creation fails: its financial scope is consumed.
  const checkpointIdentity = exclusive(frozen.paths.checkpointPath, '');
  if (optionalStat(frozen.paths.reportPath)) throw new Error('Qualification output appeared during exclusive cohort consumption.');
  const handle = Object.freeze({ paths: frozen.paths });
  handles.set(handle, { ...frozen, records: [], anchors: [initial], checkpointIdentity, claimIdentity });
  return handle;
}

/** Strict read-only replay: never creates, repairs or resumes files. A partial
 * append, deleted tail, or unanchored record cannot yield trusted qualification. */
export function readQualificationJournal(input: QualificationJournalBinding): QualificationJournalInspection {
  const frozen = frozenBinding(input), checkpoint = readBounded<QualificationJournalRecord>(frozen.paths.checkpointPath, MAX_CHECKPOINT_BYTES, true), claim = readBounded<QualificationJournalAnchor>(frozen.paths.claimPath, MAX_ANCHOR_BYTES);
  const records = checkpoint.values, anchors = claim.values;
  if (records.length > MAX_RECORDS || anchors.length !== records.length + 1) throw new Error('Qualification cohort claim and checkpoint have different durable counts.');
  let previous = ZERO, bytes = 0;
  for (const [index, record] of records.entries()) {
    const { sha256, ...body } = record;
    if (record.format !== 'grader-qualification-checkpoint-v1' || record.sequence !== index || record.previousSha256 !== previous || sha256 !== hash(body) || Object.entries(frozen.common).some(([key, value]) => record[key] !== value) || !validDate(record.createdAt) || !eventKinds.has(record.kind)) throw new Error('Qualification checkpoint sequence, hash, binding or provenance changed.');
    if (index === 0 && record.kind !== 'intent' || index > 0 && record.kind === 'intent' || records.slice(0, index).some(r => r.kind === 'finished' || r.kind === 'stopped')) throw new Error('Qualification checkpoint lifecycle cannot restart or append after a terminal.');
    previous = sha256;
  }
  previous = ZERO;
  for (const [index, anchor] of anchors.entries()) {
    const { sha256, ...body } = anchor;
    if (index) bytes += Buffer.byteLength(line(records[index - 1]));
    if (anchor.format !== 'grader-qualification-cohort-claim-v1' || anchor.sequence !== index || anchor.previousSha256 !== previous || sha256 !== hash(body) || Object.entries(frozen.common).some(([key, value]) => anchor[key as keyof QualificationJournalAnchor] !== value) || !validDate(anchor.createdAt) || anchor.ledgerPath !== frozen.paths.ledgerPath || anchor.claimPath !== frozen.paths.claimPath || anchor.checkpointPath !== frozen.paths.checkpointPath || anchor.reportPath !== frozen.paths.reportPath || anchor.recordCount !== index || anchor.tailSha256 !== (index ? records[index - 1].sha256 : ZERO) || anchor.checkpointBytes !== bytes) throw new Error('Qualification canonical cohort claim no longer anchors its exact checkpoint, paths or provenance.');
    previous = sha256;
  }
  if (bytes !== checkpoint.bytes) throw new Error('Qualification checkpoint byte count changed.');
  return { paths: frozen.paths, records, anchors };
}

export function appendQualificationJournal(handle: QualificationJournalHandle, event: QualificationJournalEvent): QualificationJournalRecord {
  const state = handles.get(handle);
  if (!state) throw new Error('Qualification journal appends require the original non-resumable execution handle.');
  plainJson(event);
  if (!event || Array.isArray(event) || typeof event !== 'object' || !eventKinds.has(event.kind) || Object.keys(event).some(key => reserved.has(key)) || state.records.length >= MAX_RECORDS || (!state.records.length ? event.kind !== 'intent' : event.kind === 'intent') || ['stopped', 'finished'].includes(state.records.at(-1)?.kind ?? '')) throw new Error('Qualification journal event has invalid metadata or lifecycle.');
  const inspection = readQualificationJournal(state.binding);
  if (hash(inspection.records) !== hash(state.records) || hash(inspection.anchors) !== hash(state.anchors) || !sameIdentity(lstatSync(state.paths.checkpointPath), state.checkpointIdentity) || !sameIdentity(lstatSync(state.paths.claimPath), state.claimIdentity) || optionalStat(state.paths.reportPath)) throw new Error('Qualification journal or output changed during execution.');
  const body = { ...structuredClone(event), format: 'grader-qualification-checkpoint-v1' as const, ...state.common, sequence: state.records.length, previousSha256: state.records.at(-1)?.sha256 ?? ZERO, createdAt: new Date().toISOString() };
  const record: QualificationJournalRecord = { ...body, sha256: hash(body) };
  append(state.paths.checkpointPath, record, state.checkpointIdentity, MAX_CHECKPOINT_BYTES); state.records.push(record);
  const nextBody = anchorBody(state), next = { ...nextBody, sha256: hash(nextBody) };
  append(state.paths.claimPath, next, state.claimIdentity, MAX_ANCHOR_BYTES); state.anchors.push(next);
  return structuredClone(record);
}

/** Immutable exclusive publication only; no rewrite or accidental JSON repair. */
export function publishQualificationJson(path: string, value: unknown): void {
  canonicalPath(path); plainJson(value);
  const content = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(content) > MAX_CHECKPOINT_BYTES) throw new Error('Qualification JSON publication exceeds its size bound.');
  ensureDirectory(dirname(path)); exclusive(path, content, 0o444);
}
