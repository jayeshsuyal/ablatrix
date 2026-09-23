import { expect, test } from '@playwright/test';

async function createChange(request: import('@playwright/test').APIRequestContext) {
  const baseline = await (await request.post('/api/experiments', { data: { taskIds: ['github-platform-v1','github-actions-v2','cloudflare-workers-v1','cloudflare-pages-v2'] } })).json();
  await expect.poll(async () => (await (await request.get(`/api/experiments/${baseline.id}`)).json()).status).toBe('completed');
  const change = await (await request.post('/api/optimizations', { data: { baselineExperimentId: baseline.id } })).json();
  await expect.poll(async () => (await (await request.get('/api/optimizations')).json()).optimizations.find((item: {id:string}) => item.id===change.id)?.status).toBe('completed');
  return { baseline, change };
}

test('empty review bench offers a real suite baseline without invented results', async ({ page }) => {
  await page.route('**/api/runs', route => route.fulfill({ json: { runs: [] } }));
  await page.route('**/api/experiments', route => route.fulfill({ json: { experiments: [] } }));
  await page.route('**/api/optimizations', route => route.fulfill({ json: { optimizations: [] } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'No experiments yet' })).toBeVisible();
  await expect(page.getByText(/Fixture responses are synthetic/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run baseline suite' })).toBeVisible();
  await expect(page.locator('.rb-case')).toHaveCount(0);
  await page.getByRole('button', { name: 'Run baseline suite' }).click();
  await expect(page.getByRole('dialog', { name: 'New experiment' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'New experiment' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Run baseline suite' })).toBeFocused();
});

test('approved chart binds real settings, case selection, tabs, links, deep links and responsive widths', async ({ page, request }) => {
  const { change } = await createChange(request);
  await page.goto(`/#change/${change.id}`);
  await expect(page.locator('.rb-case')).toHaveCount(4);
  await expect(page.locator('.rb-change')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: /Read 2 sources in parallel/ })).toBeVisible();
  await expect(page.getByText('Recorded attempt time · milliseconds')).toBeVisible();
  const first = page.locator('.rb-case').first();
  await first.click();
  await expect(page).toHaveURL(/github-platform-v1$/);
  await expect(page.getByRole('complementary', { name: 'Selected case evidence' })).toContainText('What does GitHub provide for software teams?');
  await page.getByRole('button', { name: 'Inspect baseline source 1' }).click();
  await expect(page.getByRole('button', { name: 'Sources' })).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button', { name: 'Sources' })).toBeFocused();
  await expect(page.getByText('Linked to a recorded claim').first()).toBeVisible();
  await page.getByRole('button', { name: 'Attempts' }).click();
  await expect(page.getByRole('complementary', { name: 'Selected case evidence' }).getByText('01').first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('complementary', { name: 'Selected case evidence' })).toContainText('What does GitHub provide for software teams?');
  for (const width of [1440,1024,800,736,390,320]) {
    await page.setViewportSize({ width, height: 844 });
    const overflow = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth, offenders: [...document.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map(el => `${el.tagName.toLowerCase()}.${el.className}: ${Math.round(el.getBoundingClientRect().right)}`) }));
    expect(overflow.scrollWidth <= overflow.innerWidth, `No horizontal overflow at ${width}px: ${JSON.stringify(overflow)}`).toBeTruthy();
  }
  await page.getByRole('button', { name: /Inspect GitHub github-actions-v2/ }).click();
  await expect(page.getByRole('complementary', { name: 'Selected case evidence' })).toBeFocused();
  await page.getByRole('button', { name: 'Back to cases' }).click();
  await expect(page).toHaveURL(new RegExp(`#change/${change.id}$`));
});

test('saved experiment picker changes context without inventing run groups', async ({ page, request }) => {
  const { baseline, change } = await createChange(request);
  await page.goto(`/#change/${change.id}`);
  const picker=page.getByRole('combobox', { name: 'Select saved experiment' });
  await expect(picker.locator(`option[value="change/${change.id}"]`)).toHaveText(/Change/);
  await picker.selectOption(`experiment/${baseline.id}`);
  await expect(page).toHaveURL(new RegExp(`#experiment/${baseline.id}$`));
  await expect(page.getByRole('heading', { name: 'Baseline research suite' })).toBeVisible();
  await expect(page.locator('.rb-answer[aria-label="Candidate answer"]')).toHaveCount(0);
  await picker.selectOption(`change/${change.id}`);
  await expect(page.locator('.rb-change')).toHaveCount(2);
});

test('attention filter excludes a paired pass even when the candidate took longer; filtered next follows visible cases', async ({ page, request }) => {
  const { change } = await createChange(request);
  const actual=await (await request.get(`/api/optimizations/${change.id}/comparison`)).json();
  // Test-only rubric result: both arms pass case one, while its candidate attempt time is longer.
  actual.rows[0].baseline.correct=true; actual.rows[0].candidate.correct=true;
  await page.route(`**/api/optimizations/${change.id}/comparison`, route=>route.fulfill({json:actual}));
  await page.goto(`/#change/${change.id}`);
  await expect(page.getByRole('button', { name: 'Attention 3' })).toBeVisible();
  await page.getByRole('button', { name: 'Attention 3' }).click();
  await expect(page.locator('.rb-case')).toHaveCount(3);
  await expect(page.locator('.rb-case').first()).toContainText('GitHub Actions');
  await expect(page.getByRole('button', { name: 'Previous filtered case' })).toBeDisabled();
  await page.getByRole('button', { name: 'Next filtered case' }).click();
  await expect(page).toHaveURL(/cloudflare-workers-v1$/);
  await page.getByRole('button', { name: 'All 4' }).click();
  await expect(page.locator('.rb-case')).toHaveCount(4);
});

test('pending and failed proposals never present stale candidate evidence', async ({ page, request }) => {
  const baseline = await (await request.post('/api/experiments', { data: { taskIds: ['github-platform-v1','cloudflare-workers-v1'] } })).json();
  await expect.poll(async () => (await (await request.get(`/api/experiments/${baseline.id}`)).json()).status).toBe('completed');
  const record={id:'11111111-1111-4111-8111-111111111111',mode:'fixture',status:'running',baselineExperimentId:baseline.id,candidateExperimentId:'',candidateId:'pending',settings:baseline.settings,investigation:'Development attempts recorded.',proposal:'Proposal pending.',decision:'pending',challenge:'Waiting for a bounded proposal.',error:null as string|null,updatedAt:'2026-01-01T00:00:00Z'};
  await page.route('**/api/optimizations',route=>route.fulfill({json:{optimizations:[record]}}));
  await page.route(`**/api/optimizations/${record.id}/comparison`,route=>route.fulfill({status:409,json:{error:'Candidate experiment is not ready.'}}));
  await page.goto(`/#change/${record.id}`);
  await expect(page.getByText('Candidate proposal pending.')).toBeVisible();
  await expect(page.getByText('Export unavailable until a candidate experiment is recorded.')).toBeHidden();
  await page.getByText('Export and final holdout').click();
  await expect(page.getByText('Export unavailable until a candidate experiment is recorded.')).toBeVisible();
  record.status='failed';record.decision='rejected';record.error='Provider proposal failed.';
  await page.reload();
  await expect(page.getByText('Proposal failed before candidate evidence was recorded.')).toBeVisible();
  await expect(page.locator('.rb-decision')).toContainText('Provider proposal failed.');
});

test('zero priced cost differs from unknown; missing attempt has no success bar or time delta', async ({ page, request }) => {
  const { change }=await createChange(request);
  const actual=await (await request.get(`/api/optimizations/${change.id}/comparison`)).json();
  actual.rows[0].baseline.costUsd=0;actual.rows[0].candidate.costUsd=null;actual.rows[0].candidate.attempts=0;actual.rows[0].candidate.durationMs=0;
  await page.route('**/api/health',route=>route.fulfill({json:{ok:true,mode:'live'}}));
  await page.route(`**/api/optimizations/${change.id}/comparison`,route=>route.fulfill({json:actual}));
  await page.route('**/api/experiments',async route=>{const data=await(await route.fetch()).json();const candidate=data.experiments.find((item:{id:string})=>item.id===change.candidateExperimentId);if(candidate)candidate.runIds=[];await route.fulfill({json:data})});
  await page.goto(`/#change/${change.id}`);
  await expect(page.locator('.rb-case').first()).toContainText('Missing attempt');
  await expect(page.locator('.rb-case').first().locator('.rb-bar.rb-b')).toHaveCount(0);
  await expect(page.locator('.rb-case').first().locator('.rb-delta')).toContainText('unavailable');
  const inspector=page.getByRole('complementary',{name:'Selected case evidence'});
  await expect(inspector).toContainText('$0.00');
  await expect(inspector).toContainText('Unknown');
});

test('late comparison and holdout responses cannot replace another selected change', async ({ page, request }) => {
  const first=(await createChange(request)).change,second=(await createChange(request)).change;
  const firstComparison=await(await request.get(`/api/optimizations/${first.id}/comparison`)).json();
  const secondComparison=await(await request.get(`/api/optimizations/${second.id}/comparison`)).json();
  firstComparison.rows[0].candidate.correct=false;secondComparison.rows[0].candidate.correct=true;
  await page.route(`**/api/optimizations/${first.id}/comparison`,async route=>{await new Promise(resolve=>setTimeout(resolve,650));await route.fulfill({json:firstComparison}).catch(()=>{})});
  await page.route(`**/api/optimizations/${second.id}/comparison`,route=>route.fulfill({json:secondComparison}));
  await page.route(`**/api/optimizations/${first.id}/holdout`,async route=>{await new Promise(resolve=>setTimeout(resolve,650));await route.fulfill({json:{optimizationId:first.id,mode:'fixture',sampleSize:2,baselineCorrect:2,correct:99,regressions:[]}}).catch(()=>{})});
  await page.route(`**/api/optimizations/${second.id}/holdout`,route=>route.fulfill({json:{optimizationId:second.id,mode:'fixture',sampleSize:2,baselineCorrect:0,correct:0,regressions:[]}}));
  await page.goto(`/#change/${first.id}`);await page.evaluate(id=>{location.hash=`change/${id}`},second.id);
  await expect(page.getByRole('complementary',{name:'Selected case evidence'})).toContainText('Checks passed');
  await page.waitForTimeout(800);
  await expect(page.getByRole('complementary',{name:'Selected case evidence'})).toContainText('Checks passed');
  await page.getByText('Export and final holdout').click();
  await expect(page.getByText('candidate 0/2')).toBeVisible();
  await expect(page.getByText('candidate 99/2')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`#change/${second.id}$`));
});
