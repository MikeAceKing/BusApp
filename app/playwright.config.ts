import { defineConfig } from 'playwright/test';
import { fileURLToPath } from 'node:url';

const siteRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4179', browserName: 'chromium', screenshot: 'only-on-failure' },
  webServer: {
    command: 'vite --mode production --host 127.0.0.1 --port 4179',
    cwd: siteRoot,
    url: 'http://127.0.0.1:4179',
    reuseExistingServer: false,
    timeout: 30_000,
    env: { VITE_SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key' },
  },
});
