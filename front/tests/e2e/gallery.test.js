import { expect, test } from '@playwright/test';

// Mock gallery (src/lib/mocks/gallery.js): mock-01 beach+sun, mock-02 beach, mock-03 night,
// mock-04 and mock-05 untagged, mock-06 sun.
const viewer = (page) => page.locator('[role="dialog"][aria-label="Viewer"]');
const tiles = (page) => page.locator('.gallery .tile');
const chip = (page, name) => page.locator('.tag-bar button', { hasText: name });
const tileIds = (page) => tiles(page).evaluateAll((nodes) => nodes.map((node) => node.dataset.id));
const shownFile = (page) => viewer(page).locator('img').getAttribute('src');

test.beforeEach(async ({ page }) => {
	await page.goto('/browse');
	await page.evaluate(() => localStorage.clear());
});

test('the site opens on Browse with every item and the tag filters', async ({ page }) => {
	await page.goto('/');

	await expect(page).toHaveURL(/\/browse$/);
	await expect(page.locator('h1.wordmark')).toHaveText('THE HORNY GRAIL');
	await expect(tiles(page)).toHaveCount(6);
	await expect(chip(page, 'All')).toHaveAttribute('aria-pressed', 'true');
});

test('tag chips filter the grid and are kept in the URL', async ({ page }) => {
	await chip(page, 'beach').click();
	await expect(page).toHaveURL(/\/browse\?tags=beach$/);
	await expect(tiles(page)).toHaveCount(2);

	await chip(page, 'sun').click();
	await expect(page).toHaveURL(/tags=beach%2Csun|tags=beach,sun/);
	await expect(tiles(page)).toHaveCount(1);

	await chip(page, 'Untagged').click();
	await expect(page).toHaveURL(/untagged=1/);
	await expect(tiles(page)).toHaveCount(2);

	await page.reload();
	await expect(tiles(page)).toHaveCount(2);
	await expect(chip(page, 'Untagged')).toHaveAttribute('aria-pressed', 'true');
});

test('an item opens full screen over the grid; arrows move, Esc closes, the grid keeps its order', async ({ page }) => {
	await chip(page, 'beach').click();
	await expect(tiles(page)).toHaveCount(2);
	const order = await tileIds(page);

	await tiles(page).first().click();
	await expect(viewer(page)).toBeVisible();
	await expect(page).toHaveURL(new RegExp(`/image/${order[0]}\\?tags=beach$`));
	await expect(viewer(page).locator('.label')).toHaveText('1 / 2');

	await page.keyboard.press('ArrowRight');
	await expect(page).toHaveURL(new RegExp(`/image/${order[1]}\\?tags=beach$`));
	await page.keyboard.press('ArrowRight');
	await expect(page).toHaveURL(new RegExp(`/image/${order[1]}`), 'stays on the last item');

	await page.keyboard.press('Escape');
	await expect(viewer(page)).toHaveCount(0);
	await expect(page).toHaveURL(/\/browse\?tags=beach$/);
	expect(await tileIds(page)).toEqual(order);
});

test('the Back button closes the viewer without reshuffling', async ({ page }) => {
	const order = await tileIds(page);

	await tiles(page).nth(2).click();
	await expect(viewer(page)).toBeVisible();
	await page.goBack();

	await expect(viewer(page)).toHaveCount(0);
	await expect(page).toHaveURL(/\/browse$/);
	expect(await tileIds(page)).toEqual(order);
});

test('a tag in the viewer filters the grid by it', async ({ page }) => {
	await chip(page, 'beach').click();
	await chip(page, 'sun').click();
	await expect(tiles(page)).toHaveCount(1);
	await tiles(page).first().click();

	await viewer(page).locator('.tags button', { hasText: 'sun' }).click();

	await expect(viewer(page)).toHaveCount(0);
	await expect(page).toHaveURL(/\/browse\?tags=sun$/);
	await expect(tiles(page)).toHaveCount(2);
});

test('a direct link to an item shows it, and closing goes to Browse with its filter', async ({ page }) => {
	await page.goto('/image/mock-03?tags=night');

	await expect(viewer(page)).toBeVisible();
	expect(await shownFile(page)).toContain('mock-03');
	await expect(viewer(page).locator('.tags a', { hasText: 'night' })).toBeVisible();

	await viewer(page).getByRole('button', { name: 'Close' }).click();
	await expect(page).toHaveURL(/\/browse\?tags=night$/);
	await expect(tiles(page)).toHaveCount(1);
});

test('a link to an item that is not in the Grail says so', async ({ page }) => {
	await page.goto('/image/not-a-real-item');

	await expect(page.getByText('This item is not in the Grail')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Browse' }).last()).toBeVisible();
});

test('Random follows the tag filter and only shows matching items', async ({ page }) => {
	await chip(page, 'sun').click();
	await expect(tiles(page)).toHaveCount(2);

	await page.locator('.main-nav').getByRole('link', { name: 'Random' }).click();
	await expect(page).toHaveURL(/\/random\?tags=sun$/);
	await expect(viewer(page).locator('.label')).toHaveText('Random · sun');

	const seen = new Set();
	for (let i = 0; i < 6; i += 1) {
		seen.add(await shownFile(page));
		await page.keyboard.press('ArrowRight');
	}
	expect([...seen].sort()).toEqual(['/mock-gallery/files/mock-01.svg', '/mock-gallery/files/mock-06.svg']);

	await page.keyboard.press('Escape');
	await expect(page).toHaveURL(/\/browse\?tags=sun$/);
});

test('Random can go back to the previous item', async ({ page }) => {
	await page.goto('/random');
	const first = await shownFile(page);

	await page.keyboard.press('ArrowRight');
	await expect.poll(() => shownFile(page)).not.toBe(first);
	await page.keyboard.press('ArrowLeft');

	await expect.poll(() => shownFile(page)).toBe(first);
});

test('discreet mode gives the tab a neutral title and icon, and stays on after a reload', async ({ page }) => {
	await page.getByRole('button', { name: /Discreet/ }).click();

	await expect(page).toHaveTitle('Notes');
	await expect(page.locator('.wordmark')).toHaveText('Gallery');
	expect(await page.locator('link[rel~="icon"]').first().getAttribute('href')).toMatch(/^data:image\/svg/);

	await page.reload();
	await expect(page).toHaveTitle('Notes');
	await expect(page.locator('.wordmark')).toHaveText('Gallery');

	await page.getByRole('button', { name: /Discreet/ }).click();
	await expect(page).toHaveTitle('The Horny Grail');
});

test('B hides the page at once, even over the viewer, and B brings it back', async ({ page }) => {
	await tiles(page).first().click();
	await expect(viewer(page)).toBeVisible();

	await page.keyboard.press('b');
	const cover = page.getByRole('button', { name: 'Show the page again' });
	await expect(cover).toBeVisible();
	await expect(page).toHaveTitle('Notes');

	await page.keyboard.press('b');
	await expect(cover).toHaveCount(0);
	await expect(viewer(page)).toBeVisible();
	await expect(page).toHaveTitle('The Horny Grail');
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

	test('the grid has three columns and a swipe moves through the viewer', async ({ page }) => {
		await expect(tiles(page)).toHaveCount(6);
		const columns = await page.locator('.gallery').evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length);
		expect(columns).toBe(3);

		const order = await tileIds(page);
		await tiles(page).first().click();
		await expect(page).toHaveURL(new RegExp(`/image/${order[0]}`));

		const swipe = async (fromX, toX) => {
			await page.dispatchEvent('.stage', 'pointerdown', { pointerType: 'touch', clientX: fromX, clientY: 400 });
			await page.dispatchEvent('.stage', 'pointerup', { pointerType: 'touch', clientX: toX, clientY: 400 });
		};
		await swipe(300, 80);
		await expect(page).toHaveURL(new RegExp(`/image/${order[1]}`));
		await swipe(80, 300);
		await expect(page).toHaveURL(new RegExp(`/image/${order[0]}`));
	});
});
