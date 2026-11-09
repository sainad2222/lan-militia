import { readdirSync } from 'node:fs';
import { build } from 'esbuild';

// ws loads its optional native helpers with require() inside try/catch; this gives the ESM bundle a real require.
const nodeEsm = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['bufferutil', 'utf-8-validate'],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
};

const jobs = [
  build({
    entryPoints: ['src/client/main.ts'],
    outfile: 'public/client.js',
    bundle: true,
    format: 'esm',
    target: 'es2020',
    minify: true,
    sourcemap: true,
  }),
  build({ ...nodeEsm, entryPoints: ['src/server/main.ts'], outfile: 'dist/server.js' }),
];

if (process.argv.includes('--tests')) {
  const tests = readdirSync('tests').filter((f) => f.endsWith('.test.ts'));
  jobs.push(build({ ...nodeEsm, entryPoints: tests.map((f) => `tests/${f}`), outdir: 'dist/tests' }));
}

await Promise.all(jobs);
