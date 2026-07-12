import { expect, test } from '@playwright/test';

test('index page shows the product wordmark', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('h1.wordmark')).toHaveText('THE HORNY GRAIL');
});
