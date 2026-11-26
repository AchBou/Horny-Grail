/** @type {import('@playwright/test').PlaywrightTestConfig} */
const config = {
	testDir: 'tests/e2e',
	// The tests run against the built site with the mock gallery (6 items in
	// src/lib/mocks/gallery.js), never against the real Grail.
	webServer: {
		command: 'npm run build && npm run preview',
		port: 4173,
		env: { PUBLIC_USE_MOCK_GALLERY: 'true' }
	}
};

export default config;
