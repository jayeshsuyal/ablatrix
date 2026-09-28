import { expect, test } from '@playwright/test';

test('saved paid answers can be reviewed without a model call and keep the judgment after reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/paid-review');
  await expect(page.getByRole('heading', { name: 'Check the answer, not just the quote.' })).toBeVisible();
  await expect(page.locator('.pr-queue button')).toHaveCount(20);
  await expect(page.locator('.pr-metrics')).toContainText('0/20');
  const save = page.getByRole('button', { name: 'Save review' });
  await expect(save).toBeDisabled();
  await page.locator('.pr-source-check input').first().check();
  await page.getByRole('radio', { name: 'uncertain', exact: true }).first().check();
  await page.getByRole('radio', { name: 'supported', exact: true }).check();
  await page.getByRole('textbox', { name: 'Correction or uncertainty note' }).fill('The sources disagree about suitability for well water.');
  await page.getByRole('textbox', { name: 'Reviewer name' }).fill('Synthetic browser reviewer');
  await page.getByRole('checkbox', { name: 'I checked the selected source text before judging this answer.' }).check();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.locator('.pr-verdict')).toContainText('uncertain · supported');
  await expect(page.locator('.pr-metrics')).toContainText('1/20');
  await page.reload();
  await expect(page.locator('.pr-verdict')).toContainText('Synthetic browser reviewer');
  await expect(page.locator('.pr-metrics')).toContainText('1/20');
  await page.setViewportSize({ width: 360, height: 760 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  expect(errors).toEqual([]);
});
