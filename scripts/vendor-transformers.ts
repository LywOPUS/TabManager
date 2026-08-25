import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@huggingface', 'transformers', 'dist');
const dest = join(root, 'extension', 'vendor', 'transformers');
mkdirSync(dest, { recursive: true });
for (const f of [
  'transformers.web.min.js',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
]) {
  copyFileSync(join(src, f), join(dest, f));
  console.log('copied', f);
}
