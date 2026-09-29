import { expect, test } from '@playwright/test';

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
  await page.getByRole('textbox', { name: 'Revision reviewer name' }).first().fill('Synthetic reviewer');
  await page.getByRole('button', { name: 'Request revision' }).click();
  await expect(page.locator('.pr-job')).toContainText('queued');
  await page.locator('.pr-queue button').nth(1).click();
  await expect(page.locator('.pr-detail-head')).not.toContainText('QUESTION 4');
  await expect(first).toContainText('QUEUED');
  await page.reload();
  await expect(first).toContainText('QUEUED');
});

test('a ready revision opens first with the new answer and its citations visible', async ({ page }) => {
  const overview = await (await page.request.get('/api/paid-review')).json();
  const q19 = overview.cases.find((item: { qid: string }) => item.qid === '19');
  const source = q19.sources[0];
  await page.route('**/api/paid-review/revisions', async route => {
    const response = await route.fetch();
    const payload = await response.json();
    const state = payload.cases.find((item: { qid: string }) => item.qid === '19');
    const original = state.versions[0];
    state.versions.push({ id: 'test-revision-19', parentId: original.id, model: 'test-model', createdAt: new Date().toISOString(), answer: { answer: 'Revised answer for Q19. Check the full model before ordering.', status: 'answered', citations: [{ passageId: `19:${source.sha256}`, quote: source.text.slice(0, 16) }] } });
    state.jobs.push({ id: 'test-job-19', status: 'ready', feedback: 'Test critique', createdAt: new Date().toISOString() });
    payload.ready = 1;
    await route.fulfill({ response, json: payload });
  });
  await page.goto('/paid-review');
  await expect(page.locator('.pr-detail-head')).toContainText('QUESTION 19');
  await expect(page.getByRole('region', { name: 'Revised answer for review' })).toContainText('Revised answer for Q19');
  await expect(page.locator('.pr-answer')).toHaveCount(0);
  await expect(page.locator('.pr-form')).toHaveCount(0);
  await expect(page.locator('.pr-sources article').first()).toContainText('CITED BY REVISION');
  await expect(page.locator('.pr-detail').locator('.pr-revision')).toBeVisible();
  await page.getByRole('button', { name: 'Open revised answer for Q19' }).click();
  await expect(page.locator('.pr-detail-head')).toContainText('QUESTION 19');
  await page.setViewportSize({ width: 360, height: 760 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});
