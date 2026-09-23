import { expect, test } from '@playwright/test';

test('empty workspace offers a suite baseline without invented results', async ({ page }) => {
  await page.route('**/api/runs', route => route.fulfill({ json: { runs: [] } }));
  await page.route('**/api/experiments', route => route.fulfill({ json: { experiments: [] } }));
  await page.route('**/api/optimizations', route => route.fulfill({ json: { optimizations: [] } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'No experiments yet' })).toBeVisible();
  await expect(page.getByText('Fixture responses are synthetic')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run baseline suite' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Change/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Run baseline suite' }).click();
  await expect(page.getByRole('dialog', { name: 'New experiment' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'New experiment' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Run baseline suite' })).toBeFocused();
});

test('paired board selection, filters, reload, Back, and viewport widths', async ({ page, request }) => {
  const baseline = await (await request.post('/api/experiments', { data: { taskIds: ['github-platform-v1','github-actions-v2','cloudflare-workers-v1','cloudflare-pages-v2'] } })).json();
  await expect.poll(async () => (await (await request.get(`/api/experiments/${baseline.id}`)).json()).status).toBe('completed');
  const change = await (await request.post('/api/optimizations', { data: { baselineExperimentId: baseline.id } })).json();
  await expect.poll(async () => (await (await request.get('/api/optimizations')).json()).optimizations.find((item: {id:string}) => item.id===change.id)?.status).toBe('completed');
  await page.goto(`/#change/${change.id}`);
  await expect(page.locator('.board tbody tr')).toHaveCount(4);
  await expect(page.locator('.diff-line')).toHaveCount(2);
  await page.getByRole('button', { name: 'Missing 0' }).click();
  await expect(page.getByText('No tasks match this filter.')).toBeVisible();
  await page.getByRole('button', { name: 'Show all' }).click();
  await page.getByRole('button', { name: /Inspect GitHub github-platform-v1/ }).click();
  await expect(page.getByRole('complementary', { name: 'Paired task inspector' })).toBeVisible();
  await expect(page).toHaveURL(/#change\/.*\/github-platform-v1$/);
  await page.reload();
  await expect(page.getByRole('complementary', { name: 'Paired task inspector' })).toBeVisible();
  for (const width of [1440,1024,390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  }
  await page.getByRole('button', { name: 'B / Candidate' }).click();
  await expect(page.locator('.arm-switch button').last()).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Close task inspector' }).click();
  await expect(page).toHaveURL(new RegExp(`#change/${change.id}$`));
});

test('index groups experiments and search filters without changing selection', async ({ page }) => {
  await page.goto('/');
  const index = page.getByRole('navigation', { name: 'Saved experiments' });
  await expect(index.getByRole('button', { name: /Baseline/ }).first()).toBeVisible();
  await expect(index.getByRole('button', { name: /Change/ }).first()).toBeVisible();
  const prior = await page.evaluate(() => location.hash);
  await page.getByRole('searchbox', { name: 'Search experiments' }).fill('not-a-real-experiment');
  await expect(page.getByText('No matching experiments.')).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toBe(prior);
  await page.getByRole('searchbox', { name: 'Search experiments' }).clear();
  await expect(index.getByRole('button', { name: /Baseline/ }).first()).toBeVisible();
});

test('pending and failed proposals show recorded state without a stale comparison', async ({ page, request }) => {
  const baseline = await (await request.post('/api/experiments', { data: { taskIds: ['github-platform-v1','cloudflare-workers-v1'] } })).json();
  await expect.poll(async () => (await (await request.get(`/api/experiments/${baseline.id}`)).json()).status).toBe('completed');
  const record = { id: '11111111-1111-4111-8111-111111111111', mode: 'fixture', status: 'running', baselineExperimentId: baseline.id,
    candidateExperimentId: '', candidateId: 'pending', settings: baseline.settings, investigation: 'Development attempts recorded.',
    proposal: 'Proposal pending.', decision: 'pending', challenge: 'Waiting for a bounded proposal.', error: null, updatedAt: '2026-01-01T00:00:00Z' };
  await page.route('**/api/optimizations', route => route.fulfill({ json: { optimizations: [record] } }));
  await page.route(`**/api/optimizations/${record.id}/comparison`, route => route.fulfill({ status: 409, json: { error: 'Candidate experiment is not ready.' } }));
  await page.goto(`/#change/${record.id}`);
  await expect(page.getByText('Candidate proposal is still pending.')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  record.status = 'failed'; record.decision = 'rejected'; record.error = 'Provider proposal failed.';
  await page.reload();
  await expect(page.getByText('Candidate proposal failed before a paired experiment was recorded.')).toBeVisible();
  await expect(page.locator('.decision p')).toHaveText('Provider proposal failed.');
});

test('unknown and zero costs stay distinct; empty candidate timing is not a zero bar', async ({ page, request }) => {
  const baseline = await (await request.post('/api/experiments', { data: { taskIds: ['github-platform-v1','cloudflare-workers-v1'] } })).json();
  await expect.poll(async () => (await (await request.get(`/api/experiments/${baseline.id}`)).json()).status).toBe('completed');
  const change = await (await request.post('/api/optimizations', { data: { baselineExperimentId: baseline.id } })).json();
  await expect.poll(async () => (await (await request.get('/api/optimizations')).json()).optimizations.find((item: {id:string}) => item.id===change.id)?.status).toBe('completed');
  const actual = await (await request.get(`/api/optimizations/${change.id}/comparison`)).json();
  actual.rows[0].baseline.costUsd = 0;
  actual.rows[0].candidate.costUsd = null;
  actual.rows[0].candidate.attempts = 0;
  actual.rows[0].candidate.durationMs = 0;
  await page.route('**/api/health', route => route.fulfill({ json: { ok: true, mode: 'live' } }));
  await page.route(`**/api/optimizations/${change.id}/comparison`, route => route.fulfill({ json: actual }));
  await page.route('**/api/experiments', async route => {
    const data = await (await route.fetch()).json();
    const candidate = data.experiments.find((item: {id:string}) => item.id===change.candidateExperimentId);
    if (candidate) candidate.runIds=[];
    await route.fulfill({ json: data });
  });
  await page.goto(`/#change/${change.id}`);
  const row = page.locator('.board tbody tr').first();
  await expect(row).toContainText('$0.00');
  await expect(row).toContainText('Unknown');
  await expect(row).toContainText('Missing evidence');
  await expect(row.locator('.timing-line').last().locator('i')).toHaveCount(0);
});

test('late comparison and holdout responses cannot replace a newly selected change', async ({ page, request }) => {
  async function createChange() {
    const baseline = await (await request.post('/api/experiments', { data: { taskIds: ['github-platform-v1','cloudflare-workers-v1'] } })).json();
    await expect.poll(async () => (await (await request.get(`/api/experiments/${baseline.id}`)).json()).status).toBe('completed');
    const change = await (await request.post('/api/optimizations', { data: { baselineExperimentId: baseline.id } })).json();
    await expect.poll(async () => (await (await request.get('/api/optimizations')).json()).optimizations.find((item: {id:string}) => item.id===change.id)?.status).toBe('completed');
    return change;
  }
  const first = await createChange(), second = await createChange();
  const firstComparison = await (await request.get(`/api/optimizations/${first.id}/comparison`)).json();
  const secondComparison = await (await request.get(`/api/optimizations/${second.id}/comparison`)).json();
  firstComparison.rows[0].candidate.correct=false;
  secondComparison.rows[0].candidate.correct=true;
  await page.route(`**/api/optimizations/${first.id}/comparison`, async route => { await new Promise(resolve=>setTimeout(resolve,650)); await route.fulfill({json:firstComparison}).catch(()=>{}); });
  await page.route(`**/api/optimizations/${second.id}/comparison`, route=>route.fulfill({json:secondComparison}));
  await page.route(`**/api/optimizations/${first.id}/holdout`, async route => { await new Promise(resolve=>setTimeout(resolve,650)); await route.fulfill({json:{optimizationId:first.id,mode:'fixture',sampleSize:2,baselineCorrect:2,correct:99,regressions:[]}}).catch(()=>{}); });
  await page.route(`**/api/optimizations/${second.id}/holdout`, route=>route.fulfill({json:{optimizationId:second.id,mode:'fixture',sampleSize:2,baselineCorrect:0,correct:0,regressions:[]}}));
  await page.goto(`/#change/${first.id}`);
  await page.evaluate(id=>{location.hash=`change/${id}`},second.id);
  await expect(page.locator('.board tbody tr').first()).toContainText('Passed checks');
  await expect(page.getByText(/Paired synthetic holdout: baseline 0\/2, candidate 0\/2/)).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.locator('.board tbody tr').first()).toContainText('Passed checks');
  await expect(page.getByText('candidate 99/2')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`#change/${second.id}$`));
});
