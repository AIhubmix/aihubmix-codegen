import { defineConfig } from 'tsup';

// Dual ESM + CJS + .d.ts. Output:
//   dist/index.js   (ESM, package "type":"module")
//   dist/index.cjs  (CJS — inferera-web's scripts/prerender-models.js requires this)
//   dist/index.d.ts (types)
// Consumed by the aihubmix playground (Vite/ESM) and inferera-web (CRA + Node prerender).
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  target: 'es2022',
  sourcemap: true,
  treeshake: true,
});
