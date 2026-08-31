import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const siteRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: siteRoot,
  envDir: siteRoot,
  envPrefix: ['VITE_', 'SUPABASE_PUBLISHABLE_KEY'],
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
  },
});
