import { expect, test } from '@playwright/test';

test('pinned case links persist selection, preserve other parameters, and support browser history without review writes', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', request => { if (request.method() !== 'GET' && request.url().includes('/api/paid-review')) writes.push(request.url()); });
  const overview = await (await page.request.get('/api/paid-review')).json();
  const first = overview.cases[0], target = overview.cases.find((item: { qid: string }) => item.qid === '19');
  await page.goto(`/paid-review?walkthrough=five&qid=${target.qid}#answer`);
  await expect(page.locator('.pr-detail-head h2')).toHaveText(target.question);
  await expect(page.locator('.pr-queue button[aria-current="true"]')).toContainText(target.question);
  await page.locator('.pr-queue button').first().click();
  await expect(page).toHaveURL(`/paid-review?walkthrough=five&qid=${first.qid}#answer`);
  await expect(page.locator('.pr-detail-head h2')).toHaveText(first.question);
  await page.goBack();
  await expect(page.locator('.pr-detail-head h2')).toHaveText(target.question);
  await page.goForward();
  await expect(page.locator('.pr-detail-head h2')).toHaveText(first.question);
  await page.reload();
  await expect(page.locator('.pr-detail-head h2')).toHaveText(first.question);
  await page.goto('/paid-review?walkthrough=five&qid=not-a-saved-case#answer');
  await expect(page.locator('.pr-detail-head h2')).toHaveText(first.question);
  await expect(page).toHaveURL(`/paid-review?walkthrough=five&qid=${first.qid}#answer`);
  expect(writes).toEqual([]);
});

test('saved paid answers can be reviewed without a model call and keep the judgment after reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/paid-review');
  await expect(page.getByRole('heading', { name: 'Check the answer, not just the quote.' })).toBeVisible();
  await expect(page.locator('.pr-queue button')).toHaveCount(20);
  await expect(page.locator('.pr-metrics')).toContainText('0/20');
  await expect(page.locator('.pr-ai-status').first()).toContainText('20/20 AI suggestions prepared');
  const save = page.getByRole('button', { name: 'Save review' });
  await expect(save).toBeDisabled();
  await page.getByRole('button', { name: 'Prefill my review fields' }).click();
  await expect(page.getByRole('radio', { name: 'correct', exact: true })).toBeChecked();
  await expect(page.locator('.pr-source-check input:checked')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Reviewer name', exact: true })).toHaveValue('');
  await expect(save).toBeDisabled();
  await page.locator('.pr-source-check input').first().check();
  await page.getByRole('radio', { name: 'uncertain', exact: true }).first().check();
  await page.getByRole('radio', { name: 'supported', exact: true }).check();
  await page.getByRole('textbox', { name: 'Correction or uncertainty note' }).fill('The sources disagree about suitability for well water.');
  await page.getByRole('textbox', { name: 'Reviewer name', exact: true }).fill('Synthetic browser reviewer');
  await page.getByRole('checkbox', { name: 'I checked the selected source text before judging this answer.' }).check();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.locator('.pr-verdict')).toContainText('uncertain · supported');
  await expect(page.locator('.pr-metrics')).toContainText('1/20');
  await page.reload();
  await expect(page.locator('.pr-verdict')).toContainText('Synthetic browser reviewer');
  await expect(page.locator('.pr-metrics')).toContainText('1/20');
  await page.locator('.pr-queue button').filter({ hasText: 'will this kit function properly?' }).click();
  await expect(page.locator('.pr-original-question').first()).toContainText('kenmore model 106.56369400');
  await expect(page.locator('.pr-ai-draft')).toContainText('different Kenmore model');
  await page.setViewportSize({ width: 360, height: 760 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  expect(errors).toEqual([]);
});

test('reviewer can queue a revision and continue to another answer', async ({ page }) => {
  await page.goto('/paid-review');
  const first = page.locator('.pr-queue button').first();
  await first.click();
  await page.getByRole('textbox', { name: 'What is wrong or missing?' }).fill('The answer overlooks the product source and needs a more specific response.');
  await page.getByText('Add missing information or a source', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Customer clarification (optional)', exact: true }).fill('Synthetic customer model is TEST-123.');
  await page.getByRole('textbox', { name: 'New source label', exact: true }).fill('Synthetic supplemental manual');
  await page.getByRole('textbox', { name: 'New source text', exact: true }).fill('Synthetic source: this fixture supports model TEST-123.');
  await page.getByRole('textbox', { name: 'Revision reviewer name' }).first().fill('Synthetic reviewer');
  await page.getByRole('button', { name: 'Investigate and revise' }).click();
  await expect(page.locator('.pr-job')).toContainText('queued');
  await page.locator('.pr-queue button').nth(1).click();
  await expect(page.locator('.pr-detail-head')).not.toContainText('QUESTION 4');
  await expect(first).toContainText('QUEUED');
  await page.reload();
  await expect(first).toContainText('QUEUED');
  await first.click();
  await page.getByText('Information saved for this revision request', { exact: true }).click();
  await expect(page.locator('.pr-revision')).toContainText('Synthetic supplemental manual');
  await expect(page.locator('.pr-revision')).toContainText('Synthetic customer model is TEST-123.');
});

test('a ready revision opens first with the new answer and its citations visible', async ({ page }) => {
  const overview = await (await page.request.get('/api/paid-review')).json();
  const q19 = overview.cases.find((item: { qid: string }) => item.qid === '19');
  const source = q19.sources[0];
  const added = { id: `19:${'d'.repeat(64)}`, label: 'Synthetic parts manual', text: 'This synthetic manual supports model TEST-123.', sha256: 'd'.repeat(64), originalQuestion: null, origin: 'reviewer_added', reference: 'Synthetic manual page 2', addedBy: 'Fixture reviewer' };
  await page.route('**/api/paid-review/revisions', async route => {
    const response = await route.fetch();
    const payload = await response.json();
    const state = payload.cases.find((item: { qid: string }) => item.qid === '19');
    const original = state.versions[0];
    state.versions.push({ id: 'test-revision-19', parentId: original.id, model: 'test-model', createdAt: new Date().toISOString(), context: { question:q19.question, product:{id:q19.asin,title:q19.title}, sources:[...q19.sources.map((s: {sha256: string}) => ({...s,id:`19:${s.sha256}`,origin:'pinned'})),added], clarifications:[{text:'Customer model TEST-123.',reviewer:'Fixture reviewer'}] }, answer: { answer: 'Revised answer for Q19. Check the full model before ordering.', status: 'answered', citations: [{ passageId: `19:${source.sha256}`, quote: source.text.slice(0, 16) }, {passageId:added.id,quote:added.text}] } });
    state.jobs.push({ id: 'test-job-19', versionId: 'test-revision-19', status: 'ready', reviewKind: 'ai_assisted', feedback: 'Synthetic AI-authored development critique', createdAt: new Date().toISOString() });
    payload.ready = 1;
    await route.fulfill({ response, json: payload });
  });
  await page.goto('/paid-review');
  await expect(page.locator('.pr-detail-head')).toContainText('QUESTION 19');
  await expect(page).toHaveURL('/paid-review?qid=19');
  await expect(page.getByRole('region', { name: 'Revised answer for review' })).toContainText('AI-authored development feedback. Human decision pending.');
  await expect(page.getByRole('region', { name: 'Revised answer for review' })).toContainText('Revised answer for Q19');
  await expect(page.locator('.pr-answer')).toHaveCount(0);
  await expect(page.locator('.pr-form')).toHaveCount(0);
  await expect(page.locator('.pr-sources article').first()).toContainText('CITED BY REVISION');
  const supplemental = page.locator(`#source-${added.sha256}`);
  await expect(supplemental).toContainText(added.text);
  await expect(supplemental).toContainText('Source added by Fixture reviewer');
  await expect(supplemental).toContainText('CITED BY REVISION');
  await expect(page.getByRole('link', {name:`Synthetic parts manual: “${added.text}”`})).toHaveAttribute('href', `#source-${added.sha256}`);
  await expect(page.getByRole('checkbox', {name:'Synthetic parts manual',exact:true})).toBeVisible();
  await expect(page.locator('.pr-detail').locator('.pr-revision')).toBeVisible();
  await page.goto('/paid-review?walkthrough=five&qid=4');
  await expect(page.locator('.pr-detail-head')).toContainText('QUESTION 4');
  await page.getByRole('button', { name: 'Open revised answer for Q19' }).click();
  await expect(page.locator('.pr-detail-head')).toContainText('QUESTION 19');
  await expect(page).toHaveURL('/paid-review?walkthrough=five&qid=19');
  await page.setViewportSize({ width: 360, height: 760 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test('an investigation shows its missing fact without presenting a new answer', async ({ page }) => {
  const overview = await (await page.request.get('/api/paid-review')).json();
  const q19 = overview.cases.find((item: {qid:string}) => item.qid === '19');
  await page.route('**/api/paid-review/revisions', async route => {
    const response=await route.fetch(), payload=await response.json();
    const state=payload.cases.find((item:{qid:string})=>item.qid==='19');
    state.generationAttempts=0;
    state.jobs=[{id:'synthetic-investigation',status:'needs_information',feedback:'Missing compatibility proof.',createdAt:new Date().toISOString(),investigation:{protocol:'revision-investigation-v1',planner:'rules',issue:'missing_evidence',status:'needs_information',query:'241543917 replacement',requestedIdentifiers:['241543917'],selectedSourceIds:[],addedSourceIds:[],newEvidence:false,externalCalls:0,stopReason:'No applicable compatibility source was found.',clarificationQuestion:'What is the full refrigerator model number?',steps:[{kind:'local_search',status:'completed',detail:'The saved customer answers concern other models.'},{kind:'web_search',status:'skipped',detail:'External discovery is disabled in this synthetic test.'}]}}];
    await route.fulfill({response,json:payload});
  });
  await page.goto('/paid-review');
  await page.locator('.pr-queue button').filter({hasText:q19.question}).click();
  const investigation=page.getByRole('complementary',{name:'Source investigation'});
  await expect(investigation).toContainText('What is the full refrigerator model number?');
  await expect(investigation).toContainText('No new source evidence added.');
  await expect(page.locator('.pr-compare')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Investigate and revise'})).toBeVisible();
  await investigation.getByText('See search and source decisions').click();
  await expect(investigation).toContainText('other models');
  await expect(page.locator('.pr-detail > section').first()).toHaveAttribute('class','pr-revision');
  await page.setViewportSize({width:360,height:760});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test('a newer investigation keeps an earlier rejected revision out of acceptance controls', async ({ page }) => {
  await page.route('**/api/paid-review/revisions', async route => {
    const response = await route.fetch(), payload = await response.json();
    const state = payload.cases.find((item: {qid: string}) => item.qid === '19');
    const original = state.versions[0];
    state.versions.push({ ...original, id: 'synthetic-earlier-revision', parentId: original.id, answer: { ...original.answer, answer: 'Earlier synthetic revision awaiting better compatibility support.' } });
    state.generationAttempts = 1;
    state.jobs = [
      { id: 'synthetic-first-job', versionId: 'synthetic-earlier-revision', status: 'ready', createdAt: new Date().toISOString() },
      { id: 'synthetic-newer-investigation', parentId: 'synthetic-earlier-revision', status: 'needs_information', createdAt: new Date().toISOString() }
    ];
    await route.fulfill({ response, json: payload });
  });
  await page.goto('/paid-review');
  await page.locator('.pr-queue button').filter({ hasText: '241543917' }).click();
  await expect(page.locator('.pr-compare')).toContainText('Earlier synthetic revision');
  await expect(page.locator('.pr-revision')).toContainText('This answer has a newer revision request.');
  await expect(page.getByRole('button', { name: 'Accept revision', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Investigate and revise' })).toBeVisible();
});
