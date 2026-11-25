/** @type {import('@playwright/test').PlaywrightTestConfig} */
const config = {
	testDir: 'tests/e2e',
	webServer: {
		command: 'npm run build && npm run preview',
		port: 4173
	}
};

export default config;
