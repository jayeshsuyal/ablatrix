import { DatabaseSync } from 'node:sqlite';
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ExperimentRecord, OptimizationRecord, RunRecord } from './contracts.ts';

export class RunStore {
  private db: DatabaseSync;
  private lockPath: string | null;
  private static owners = new Map<string, number>();
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    // Every :memory: connection owns a separate database, even across processes.
    this.lockPath = path === ':memory:' ? null : `${resolve(path)}.lock`;
    const count = this.lockPath ? RunStore.owners.get(this.lockPath) ?? 0 : 0;
    if (this.lockPath && !count) {
      try {
        const fd = openSync(this.lockPath, 'wx');
        writeFileSync(fd, String(process.pid)); closeSync(fd);
      } catch (error) {
        const pid = Number(readFileSync(this.lockPath, 'utf8'));
        let alive = false;
        if (Number.isSafeInteger(pid) && pid > 0) {
          try { process.kill(pid, 0); alive = true; } catch (check) { if ((check as NodeJS.ErrnoException).code !== 'ESRCH') alive = true; }
        }
        if (alive) throw new Error(`Database is owned by process ${pid}; close it before opening another process.`);
        unlinkSync(this.lockPath);
        const fd = openSync(this.lockPath, 'wx');
        writeFileSync(fd, String(process.pid)); closeSync(fd);
      }
    }
    if (this.lockPath) RunStore.owners.set(this.lockPath, count + 1);
    this.db = new DatabaseSync(path);
    this.db.exec(`CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL, status TEXT NOT NULL,
      started_at TEXT NOT NULL, document TEXT NOT NULL
    ); CREATE INDEX IF NOT EXISTS runs_started_at ON runs(started_at DESC);
    CREATE TABLE IF NOT EXISTS experiments (
      id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL, document TEXT NOT NULL
    ); CREATE INDEX IF NOT EXISTS experiments_created_at ON experiments(created_at DESC);
    CREATE TABLE IF NOT EXISTS research_cache (
      cache_key TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, document TEXT NOT NULL
    ); CREATE TABLE IF NOT EXISTS optimizations (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, document TEXT NOT NULL
    ); CREATE TABLE IF NOT EXISTS budget_calls (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, owner_id TEXT NOT NULL, max_cents INTEGER NOT NULL,
      actual_cents INTEGER, status TEXT NOT NULL, evidence TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );`);
    const columns = this.db.prepare('PRAGMA table_info(budget_calls)').all() as { name: string }[];
    if (!columns.some(column => column.name === 'owner_id')) this.db.exec("ALTER TABLE budget_calls ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'legacy-unlinked'");
    if (!count) { this.recoverBudgetCalls(); this.recoverHoldouts(); }
  }
  save(run: RunRecord): void {
    this.db.prepare(`INSERT INTO runs (id,task_id,status,started_at,document) VALUES (?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status, document=excluded.document`)
      .run(run.id, run.taskId, run.status, run.startedAt, JSON.stringify(run));
  }
  get(id: string): RunRecord | null {
    const row = this.db.prepare('SELECT document FROM runs WHERE id=?').get(id) as { document: string } | undefined;
    return row ? JSON.parse(row.document) as RunRecord : null;
  }
  list(): RunRecord[] {
    return (this.db.prepare('SELECT document FROM runs ORDER BY started_at DESC LIMIT 100').all() as { document: string }[])
      .map(row => JSON.parse(row.document) as RunRecord);
  }
  allRunsForReport(): RunRecord[] {
    return (this.db.prepare('SELECT document FROM runs ORDER BY started_at DESC').all() as { document: string }[])
      .map(row => JSON.parse(row.document) as RunRecord);
  }
  saveExperiment(experiment: ExperimentRecord): void {
    this.db.prepare(`INSERT INTO experiments (id,status,created_at,document) VALUES (?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status, document=excluded.document`)
      .run(experiment.id, experiment.status, experiment.createdAt, JSON.stringify(experiment));
  }
  saveLinkedCandidate(experiment: ExperimentRecord, optimization: OptimizationRecord): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const saved = this.getOptimization(optimization.id);
      if (!saved || saved.status !== 'running' || saved.candidateExperimentId || this.getExperiment(experiment.id)) throw new Error('Candidate experiment cannot be linked to this optimization.');
      optimization.candidateExperimentId = experiment.id;
      this.saveExperiment(experiment);
      this.saveOptimization(optimization);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      optimization.candidateExperimentId = '';
      throw error;
    }
  }
  getExperiment(id: string): ExperimentRecord | null {
    const row = this.db.prepare('SELECT document FROM experiments WHERE id=?').get(id) as { document: string } | undefined;
    return row ? JSON.parse(row.document) as ExperimentRecord : null;
  }
  listExperiments(): ExperimentRecord[] {
    return (this.db.prepare('SELECT document FROM experiments ORDER BY created_at DESC LIMIT 100').all() as { document: string }[])
      .map(row => JSON.parse(row.document) as ExperimentRecord);
  }
  pendingExperiments(): ExperimentRecord[] {
    return (this.db.prepare("SELECT document FROM experiments WHERE status IN ('queued','running') ORDER BY created_at ASC").all() as { document: string }[])
      .map(row => JSON.parse(row.document) as ExperimentRecord);
  }
  hasInterruptedLiveExperiment(): boolean {
    return this.db.prepare("SELECT 1 FROM experiments WHERE status='interrupted' LIMIT 1").get() !== undefined;
  }
  cachedResearch(key: string): unknown | null {
    const row = this.db.prepare('SELECT document,expires_at FROM research_cache WHERE cache_key=?').get(key) as { document: string; expires_at: number } | undefined;
    return row && row.expires_at > Date.now() ? JSON.parse(row.document) as unknown : null;
  }
  cacheResearch(key: string, output: unknown, ttlMinutes: number): void {
    this.db.prepare('INSERT INTO research_cache (cache_key,expires_at,document) VALUES (?,?,?) ON CONFLICT(cache_key) DO UPDATE SET expires_at=excluded.expires_at,document=excluded.document')
      .run(key, Date.now() + ttlMinutes * 60_000, JSON.stringify(output));
  }
  saveOptimization(item: OptimizationRecord): void {
    this.db.prepare('INSERT INTO optimizations (id,created_at,document) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document')
      .run(item.id, item.createdAt, JSON.stringify(item));
  }
  getOptimization(id: string): OptimizationRecord | null {
    const row = this.db.prepare('SELECT document FROM optimizations WHERE id=?').get(id) as { document: string } | undefined;
    return row ? JSON.parse(row.document) as OptimizationRecord : null;
  }
  listOptimizations(): OptimizationRecord[] {
    return (this.db.prepare('SELECT document FROM optimizations ORDER BY created_at DESC LIMIT 100').all() as { document: string }[])
      .map(row => JSON.parse(row.document) as OptimizationRecord);
  }
  pendingOptimizations(): OptimizationRecord[] {
    return (this.db.prepare('SELECT document FROM optimizations').all() as { document: string }[])
      .map(row => JSON.parse(row.document) as OptimizationRecord)
      .filter(item => item.status === 'running' && !item.candidateExperimentId);
  }
  reserveCharge(id: string, kind: 'research' | 'proposal', maxCents: number, capCents: number, ownerId = id): void {
    if (!Number.isSafeInteger(maxCents) || maxCents <= 0 || !Number.isSafeInteger(capCents) || capCents <= 0) throw new Error('Invalid budget reservation');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.db.prepare('SELECT id FROM budget_calls WHERE id=?').get(id);
      if (existing) throw new Error('Duplicate budget reservation');
      const totals = this.db.prepare(`SELECT
        COALESCE(SUM(CASE WHEN status='settled' THEN actual_cents ELSE max_cents END),0) AS committed,
        COALESCE(SUM(CASE WHEN status IN ('unknown','overage') THEN 1 ELSE 0 END),0) AS unknown
        FROM budget_calls`).get() as { committed: number; unknown: number };
      if (totals.unknown) throw new Error('Budget has an unknown paid call; reconcile it before dispatch');
      if (totals.committed + maxCents > capCents) throw new Error('Approved budget exhausted');
      const now = new Date().toISOString();
      this.db.prepare(`INSERT INTO budget_calls(id,kind,owner_id,max_cents,actual_cents,status,evidence,created_at,updated_at)
        VALUES(?,?,?,?,NULL,'reserved',NULL,?,?)`).run(id, kind, ownerId, maxCents, now, now);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  settleCharge(id: string, actualCents: number, evidence: string): void {
    if (!Number.isSafeInteger(actualCents) || actualCents < 0 || !evidence.trim()) throw new Error('Invalid charge evidence');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare('SELECT max_cents,actual_cents,status,evidence FROM budget_calls WHERE id=?').get(id) as
        { max_cents: number; actual_cents: number | null; status: string; evidence: string | null } | undefined;
      if (!row) throw new Error('Budget reservation missing');
      if (row.status === 'settled' || row.status === 'overage') {
        if (row.actual_cents !== actualCents || row.evidence !== evidence) throw new Error('Conflicting charge settlement');
      } else {
        this.db.prepare(`UPDATE budget_calls SET actual_cents=?,status=?,evidence=?,updated_at=? WHERE id=?`)
          .run(actualCents, actualCents > row.max_cents ? 'overage' : 'settled', evidence, new Date().toISOString(), id);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  markChargeUnknown(id: string): void {
    this.db.prepare(`UPDATE budget_calls SET status='unknown',updated_at=? WHERE id=? AND status='reserved'`)
      .run(new Date().toISOString(), id);
  }
  recoverBudgetCalls(): void {
    this.db.prepare(`UPDATE budget_calls SET status='unknown',updated_at=? WHERE status='reserved'`)
      .run(new Date().toISOString());
  }
  private recoverHoldouts(): void {
    const rows = this.db.prepare('SELECT document FROM optimizations').all() as { document: string }[];
    for (const row of rows) {
      const item = JSON.parse(row.document) as OptimizationRecord;
      if (item.holdoutStatus !== 'running') continue;
      item.holdoutStatus = 'failed';
      item.updatedAt = new Date().toISOString();
      this.saveOptimization(item);
    }
  }
  budgetSummary(capCents: number) {
    const rows = this.db.prepare('SELECT status,max_cents,actual_cents FROM budget_calls').all() as
      { status: string; max_cents: number; actual_cents: number | null }[];
    const settledCents = rows.filter(row => row.status === 'settled').reduce((sum, row) => sum + (row.actual_cents ?? 0), 0);
    const reservedCents = rows.filter(row => row.status === 'reserved').reduce((sum, row) => sum + row.max_cents, 0);
    const unknownCents = rows.filter(row => row.status === 'unknown' || row.status === 'overage')
      .reduce((sum, row) => sum + (row.status === 'overage' ? row.actual_cents ?? row.max_cents : row.max_cents), 0);
    return { capCents, settledCents, reservedCents, unknownCents,
      availableCents: Math.max(0, capCents - settledCents - reservedCents - unknownCents),
      blocked: unknownCents > 0 || settledCents + reservedCents + unknownCents >= capCents };
  }
  getCharge(id: string) {
    return this.db.prepare('SELECT id,kind,owner_id AS ownerId,max_cents AS maxCents,actual_cents AS actualCents,status,evidence FROM budget_calls WHERE id=?').get(id) as
      { id: string; kind: string; ownerId: string; maxCents: number; actualCents: number | null; status: string; evidence: string | null } | undefined;
  }
  close(): void {
    this.db.close();
    if (!this.lockPath) return;
    const count = RunStore.owners.get(this.lockPath) ?? 1;
    if (count <= 1) { RunStore.owners.delete(this.lockPath); unlinkSync(this.lockPath); }
    else RunStore.owners.set(this.lockPath, count - 1);
  }
}
