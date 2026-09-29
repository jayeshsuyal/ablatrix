import { expect, test } from '@playwright/test';
import type { WorkspaceProduct, WorkspaceRun } from '../server/product-workspace.ts';

test('workspace import keeps a customer question separate and displays it beside its answer', async ({ page }) => {
  const originalQuestion = 'Will this drawer fit Kenmore 25367889506?';
  const answerText = 'This OEM part matches your model. The drawer has a clear front.';
  let products: WorkspaceProduct[] = [], runs: WorkspaceRun[] = [];
  await page.route('**/api/workspace{,/**}', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/workspace/products') {
      const body = route.request().postDataJSON();
      expect(body.sources[0]).toEqual({ label: 'Customer Q&A', text: answerText, originalQuestion });
      const product = { ...body, id: 'synthetic-product', createdAt: '2026-09-29T12:00:00Z', sources: body.sources.map((source: object) => ({ ...source, id: 'synthetic-source' })) } as WorkspaceProduct;
      products = [product];
      return route.fulfill({ status: 201, json: product });
    }
    if (path === '/api/workspace/questions') {
      const body = route.request().postDataJSON();
      expect(body.mode).toBe('preview');
      const run: WorkspaceRun = { id: 'synthetic-preview', productId: products[0].id, question: body.question, mode: 'preview', status: 'evidence_ready', retrieval: { passages: [{ id: 'synthetic-source', productId: products[0].id, source: 'Customer Q&A', reference: 'Customer Q&A', text: answerText, originalQuestion, sha256: 'a'.repeat(64), lexicalRank: 1, semanticRank: 1, score: 1 }], durationMs: 1, method: 'synthetic test retrieval', embeddingModel: 'synthetic test embedding', corpusVersion: 'synthetic test corpus' }, answer: null, model: null, usage: null, error: null, createdAt: '2026-09-29T12:00:00Z' };
      runs = [run];
      return route.fulfill({ status: 201, json: run });
    }
    return route.fulfill({ json: { products, runs, readiness: { ready: false, reason: 'Synthetic browser test; no provider calls.' }, busy: false } });
  });
  await page.goto('/ask');
  await page.getByRole('textbox', { name: 'Product name', exact: true }).fill('Synthetic replacement drawer');
  await page.getByRole('textbox', { name: 'Source label', exact: true }).fill('Customer Q&A');
  await page.getByRole('textbox', { name: 'Evidence text', exact: true }).fill(answerText);
  await page.getByRole('textbox', { name: 'Original customer question (optional)' }).fill(originalQuestion);
  await page.getByRole('button', { name: 'Save product', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Product evidence saved');
  await page.getByRole('textbox', { name: 'Question', exact: true }).fill('Does this fit my Frigidaire refrigerator?');
  await page.getByRole('button', { name: 'Preview evidence', exact: true }).click();
  await expect(page.locator('.ask-original-question')).toContainText(originalQuestion);
  await expect(page.locator('.ask-original-question')).toContainText('the question is not a confirmed product fact');
  await expect(page.locator('.ask-evidence article > p').last()).toHaveText(answerText);
  await expect(page.locator('.ask-evidence blockquote')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.ask-original-question')).toContainText(originalQuestion);
  await page.setViewportSize({ width: 360, height: 760 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});
