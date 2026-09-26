import { expect, test } from '@playwright/test';
import type { LoopOverview } from '../server/loop-types.ts';

test('feedback loop persists a reviewed proposal, validates, promotes and rolls back without claiming learning', async ({ page, request }) => {
  test.setTimeout(120_000);
  const browserErrors: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.setDefaultTimeout(15_000);
  await page.goto('/loop?mode=fixture');
  await expect(page.getByRole('heading', { name: 'Evidence to decision' })).toBeVisible();
  await expect(page.locator('.fl-disclosure')).toContainText('answers and feedback outcomes do not establish model improvement');
  await expect(page.getByRole('combobox', { name: 'Product', exact: true })).not.toHaveValue('');

  // Editing a predefined question must remove its benchmark case identity.
  const originalQuestion = await page.getByRole('textbox', { name: 'Question', exact: true }).inputValue();
  const originalCase = await page.getByRole('combobox', { name: 'Development case', exact: true }).inputValue();
  await page.getByRole('textbox', { name: 'Question', exact: true }).fill(`${originalQuestion} Please explain.`);
  await expect(page.getByRole('combobox', { name: 'Development case', exact: true })).toHaveValue('');
  await page.getByRole('combobox', { name: 'Development case', exact: true }).selectOption(originalCase);

  await page.getByRole('button', { name: 'Get an answer', exact: true }).click();
  await expect(page.locator('.fl-answer')).toContainText('SYNTHETIC FIXTURE', { timeout: 60_000 });
  await page.locator('.fl-retrieval-map > summary').click();
  await expect(page.locator('.fl-rank-rows button').first()).toBeVisible();
  const save = page.locator('.fl-form-footer button');
  await expect(save).toBeDisabled();
  await page.getByRole('group', { name: 'Is the answer correct?', exact: true }).getByRole('radio', { name: 'No', exact: true }).check();
  await page.getByRole('group', { name: 'Is it supported by the evidence?', exact: true }).getByRole('radio', { name: 'Yes', exact: true }).check();
  await page.getByRole('combobox', { name: 'Issue category', exact: true }).selectOption('unnecessary_abstention');
  await page.getByPlaceholder('Describe the supported answer and what the agent missed…').fill('For this synthetic exercise, a relevant product passage is available. Return a cited extract instead of the scripted abstention.');
  await page.locator('.fl-detail-review > summary').click();
  await page.getByRole('button', { name: 'Add requested detail' }).click();
  await page.getByRole('textbox', { name: 'Requested detail' }).fill('Handle material');
  await page.getByRole('button', { name: 'Continue to checked evidence' }).click();
  await page.getByRole('group', { name: 'Evidence you personally checked' }).getByRole('checkbox').first().check();
  await expect(save).toBeDisabled();
  await page.getByRole('checkbox', { name: 'I checked the reference or correction against the source evidence.' }).check();
  await expect(save).toBeDisabled();
  await page.getByRole('button', { name: 'Continue to confirmation' }).click();
  await page.getByRole('textbox', { name: 'Reviewer name', exact: true }).fill('Browser test reviewer');
  await page.getByRole('button', { name: 'Judgment' }).click();
  await page.getByRole('combobox', { name: 'Evidence', exact: true }).selectOption('listing');
  await expect(save).toBeDisabled();
  await page.getByRole('combobox', { name: 'Answer', exact: true }).selectOption('missed');
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.locator('.fl-notice')).toContainText('Feedback saved');

  await page.getByRole('navigation', { name: 'Feedback loop stages' }).getByRole('button', { name: 'Policy change' }).click();
  await page.locator('.fl-improve-grid').getByRole('button', { name: 'Propose an update', exact: true }).click();
  await expect(page.locator('.fl-rationale')).toContainText('Synthetic mechanism exercise');
  await expect(page.locator('.fl-policy-diff')).toContainText('CANDIDATE INSTRUCTIONS');
  await page.getByRole('button', { name: 'Continue to validation' }).click();
  await page.getByRole('button', { name: 'Run paired validation' }).click();
  await expect(page.locator('.fl-validation')).toContainText('SYNTHETIC mechanism exercise', { timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Apply promotion gate' })).toBeEnabled();
  await page.getByRole('button', { name: 'Apply promotion gate' }).click();
  await expect(page.locator('.fl-decision-reason')).toContainText('SYNTHETIC workflow scores, not model quality');
  await expect(page.locator('.fl-validation .fl-badge').first()).toHaveText('accepted');

  await page.getByRole('navigation', { name: 'Feedback loop stages' }).getByRole('button', { name: 'Final evaluation' }).click();
  await page.getByRole('button', { name: 'Run final paired comparison' }).click();
  await expect(page.locator('.fl-final-cases details')).toHaveCount(20, { timeout: 60_000 });
  await expect(page.locator('.fl-final-body')).toContainText('SYNTHETIC fixture scores', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Reveal final report' }).click();
  await expect(page.locator('.fl-final-report')).toContainText('Synthetic report demonstration');
  await page.locator('.fl-final-cases details').first().locator('summary').click();
  await page.locator('.fl-final-cases details').first().getByRole('button', { name: /Inspect answer & review/ }).first().click();
  await expect(page.locator('.fl-form-footer button')).toBeDisabled();

  const overview = await (await request.get('/api/loop')).json() as LoopOverview;
  expect(overview.activePolicyIds.fixture).not.toBe('fixture-baseline');
  expect(overview.activePolicyIds.live).toBe('live-baseline');
  expect(overview.runs.filter(run => run.mode === 'fixture').every(run => run.feedback?.kind === 'synthetic')).toBeTruthy();
  expect(overview.runs.find(run => run.feedback?.details?.some(detail => detail.detail === 'Handle material'))?.feedback?.details?.[0].response).toBe('missed');
  const exported = await request.get('/api/loop/export');
  expect(exported.ok()).toBeTruthy();
  expect(exported.headers()['content-disposition']).toContain('attachment');
  expect((await exported.json()).format).toBe('ablatrix-feedback-loop-v0.3');

  await page.reload();
  await expect(page.locator('.fl-project-state')).toContainText('Policy 2');
  await page.getByRole('navigation', { name: 'Feedback loop stages' }).getByRole('button', { name: 'History' }).click();
  await page.getByRole('button', { name: 'Restore this policy' }).click();
  await expect(page.locator('.fl-notice')).toContainText('Policy restored');
  await expect(page.locator('.fl-project-state')).toContainText('Baseline');

  await page.setViewportSize({ width: 320, height: 740 });
  for (const stage of ['Answer & review', 'Compare answers', 'Policy change', 'Decision', 'Final evaluation', 'History']) {
    await page.getByRole('navigation', { name: 'Feedback loop stages' }).getByRole('button', { name: stage }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  }
  await page.getByRole('button', { name: 'Live experiment', exact: true }).click();
  await page.getByRole('navigation', { name: 'Feedback loop stages' }).getByRole('button', { name: 'Answer & review' }).click();
  await expect(page.getByRole('button', { name: 'Get an answer', exact: true })).toHaveCount(0);
  await expect(page.locator('.fl-ask')).toContainText('Live answering is unavailable in this local session');
  expect(browserErrors).toEqual([]);
});
