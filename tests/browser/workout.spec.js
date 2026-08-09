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

test('chooses a gym point on the map and keeps it on this device', async ({ page, context }) => {
  await context.grantPermissions(['geolocation'], { origin: 'http://127.0.0.1:4173' });
  await context.setGeolocation({ latitude: 52.302, longitude: 8.895, accuracy: 12 });
  await page.getByRole('button', { name: /Settings|Einstellungen/ }).click();
  await page.getByRole('button', { name: /Choose gym on map|Gym auf Karte auswählen/ }).click();
  await expect(page.locator('.geo-map')).toBeVisible();
  await expect(page.getByText('52.30200, 8.89500')).toBeVisible();
  await page.getByRole('button', { name: /Save point as gym|Punkt als Gym speichern/ }).click();
  await expect(page.getByRole('checkbox', { name: /Suggest today’s workout|Heutiges Training/ })).toBeChecked();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('liftlog.gymLocation.v1')));
  expect(saved).toMatchObject({ latitude: 52.302, longitude: 8.895, enabled: true });
});
