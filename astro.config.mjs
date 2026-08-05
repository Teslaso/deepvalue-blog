// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
// Keep Astro's content-layer cache project-local. The Publisher's isolated
// preview builds symlink node_modules from the live repository, so the default
// cacheDir (./node_modules/.astro) would be shared between concurrent builds
// and corrupt each other's content collections.
export default defineConfig({
  cacheDir: './.astro/cache',
});
