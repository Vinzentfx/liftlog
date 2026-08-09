import { test, expect } from 'playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?e2e=1#/train');
});

test('starts, pauses and resumes a workout in the real app', async ({ page }) => {
  await page.getByRole('button', { name: /Start empty workout|Leeres Training starten/ }).click();
  await expect(page.getByRole('button', { name: /Pause|Pausieren/ })).toBeVisible();
  await page.getByRole('button', { name: /Pause|Pausieren/ }).click();
  await expect(page.getByText(/Workout time is stopped|Trainingszeit ist angehalten/)).toBeVisible();
  await page.getByRole('button', { name: /Resume|Fortsetzen/ }).click();
  await expect(page.getByRole('button', { name: /Pause|Pausieren/ })).toBeVisible();
});

test('main tabs stay interactive and sections collapse', async ({ page }) => {
  await page.getByRole('tab', { name: /Plans|Pläne/ }).click();
  const heading = page.locator('.section-head h2[role="button"]').first();
  await expect(heading).toHaveAttribute('aria-expanded', 'true');
  await heading.click();
  await expect(heading).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await expect(page.locator('.section-head h2[role="button"]').first()).toHaveAttribute('aria-expanded', 'false');
});
