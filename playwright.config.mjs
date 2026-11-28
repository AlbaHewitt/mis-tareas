// Pruebas de pantallas (npm run test:pantallas): la app en un navegador como el del iPhone.
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'tests-e2e',
  timeout: 20000,
  reporter: process.env.CI ? 'github' : 'list',
  use: { ...devices['iPhone 13'], baseURL: 'http://localhost:5180', serviceWorkers: 'block', locale: 'es-ES', timezoneId: 'Europe/Madrid' },
  projects: [{ name: 'iphone', use: { browserName: 'webkit' } }],
  webServer: { command: 'node tools/servidor-pruebas.mjs', url: 'http://localhost:5180', reuseExistingServer: !process.env.CI },
});
