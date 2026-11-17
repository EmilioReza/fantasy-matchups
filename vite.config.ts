import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// GitHub Pages serves the site from /<repo-name>/.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/fantasy-matchups/',
  plugins: [preact()],
  build: { target: 'es2020' },
});
