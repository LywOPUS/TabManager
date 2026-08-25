import assert from 'node:assert/strict';
import { MIN_READY_ONNX, MIN_READY_ONNX_DATA, MODEL_NOT_DOWNLOADED, __test__ } from './browserModelCache.js';

const {
  cacheUrlMatchesModel,
  dtypeFromCacheUrl,
  isLeftoverEntry,
  hasUsableOnnx,
  missingOnnxGraph,
  summarizeModelEntries,
  buildModelInventory,
  isModelInventoryReady,
  accumulateDownloadProgress,
  formatDownloadStatus,
  formatLoadStatus,
  installCacheOnlyFetch,
  responseWithReadableBody,
} = __test__;

const gemma = 'onnx-community/embeddinggemma-300m-ONNX';
assert.equal(
  cacheUrlMatchesModel(
    'https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX/resolve/main/onnx/model_quantized.onnx',
    gemma,
  ),
  true,
);
assert.equal(
  cacheUrlMatchesModel(
    'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx',
    gemma,
  ),
  false,
);
assert.equal(dtypeFromCacheUrl('onnx/model_fp16.onnx'), 'fp16');
assert.equal(dtypeFromCacheUrl('onnx/model_quantized.onnx'), 'q8');

const files = new Map();
accumulateDownloadProgress(files, {
  status: 'progress',
  file: 'onnx/model_quantized.onnx',
  loaded: 50 * 1024 * 1024,
  total: 200 * 1024 * 1024,
  progress: 25,
});
const mid = accumulateDownloadProgress(files, {
  status: 'progress',
  file: 'tokenizer.json',
  loaded: 1 * 1024 * 1024,
  total: 2 * 1024 * 1024,
});
assert.ok(mid.pct > 20 && mid.pct < 30, `总体进度应约 25%，实际 ${mid.pct}`);
assert.equal(mid.count, 2);
accumulateDownloadProgress(files, { status: 'done', file: 'tokenizer.json', total: 2 * 1024 * 1024 });
const again = accumulateDownloadProgress(files, {
  status: 'progress',
  file: 'onnx/model_quantized.onnx',
  loaded: 60 * 1024 * 1024,
  total: 200 * 1024 * 1024,
});
assert.ok(again.pct >= mid.pct, '换文件时总体进度不应倒退到 0');
assert.match(formatDownloadStatus(again), /下载中/);
assert.equal(formatLoadStatus(again), '正在加载模型');
assert.doesNotMatch(formatLoadStatus(again), /下载|文件已齐/);
accumulateDownloadProgress(files, {
  status: 'done',
  file: 'onnx/model_quantized.onnx',
  loaded: 200 * 1024 * 1024,
  total: 200 * 1024 * 1024,
});
const finished = accumulateDownloadProgress(files, {
  status: 'done',
  file: 'tokenizer.json',
  loaded: 2 * 1024 * 1024,
  total: 2 * 1024 * 1024,
});
assert.equal(finished.complete, true);
assert.equal(finished.pct, 100);
assert.match(formatDownloadStatus(finished), /文件已齐/);
assert.doesNotMatch(formatDownloadStatus(finished), /下载中 99%/);

const gemmaMeta = {
  id: gemma,
  label: 'EmbeddingGemma',
  note: '',
  bundled: false,
};
const miniMeta = {
  id: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
  label: '多语言 MiniLM',
  note: '',
  bundled: false,
};
const bundledMeta = {
  id: 'Xenova/all-MiniLM-L6-v2',
  label: 'MiniLM-L6',
  note: '',
  bundled: true,
};

const edgeNow = [
  {
    url: 'https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/resolve/main/onnx/model_fp16.onnx',
    bytes: 224 * 1024 * 1024,
  },
  {
    url: 'https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/resolve/main/tokenizer.json',
    bytes: 16 * 1024 * 1024,
  },
  {
    url: 'https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX/resolve/main/tokenizer.json',
    bytes: 19 * 1024 * 1024,
  },
  {
    url: 'https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX/resolve/main/onnx/model_fp16.onnx',
    bytes: 0.63 * 1024 * 1024,
  },
  {
    url: 'https://huggingface.co/some-old/unknown-model/resolve/main/onnx/model.onnx',
    bytes: 40 * 1024 * 1024,
  },
];

assert.equal(isLeftoverEntry(edgeNow[0]), true, '完整 fp16 算残留');
assert.equal(isLeftoverEntry(edgeNow[3]), true, 'fp16 图文件算残留');
assert.equal(isLeftoverEntry(edgeNow[4]), true, '对不上的模型算残留');
assert.equal(isLeftoverEntry(edgeNow[2]), false, '已知模型的分词器留下');
assert.equal(
  isLeftoverEntry({
    url: 'https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX/resolve/main/onnx/model_quantized.onnx',
    bytes: 568 * 1024,
  }),
  false,
  '量化图文件再小也不能当残留删',
);

const gemmaWeightsOnly = [
  {
    url: 'https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX/resolve/main/onnx/model_quantized.onnx_data',
    bytes: 294 * 1024 * 1024,
  },
  {
    url: 'https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX/resolve/main/tokenizer.json',
    bytes: 19 * 1024 * 1024,
  },
];
assert.equal(hasUsableOnnx(gemmaWeightsOnly), false, '只有 onnx_data 还不能加载');
assert.equal(missingOnnxGraph(gemmaWeightsOnly).length, 1);
const weightsRow = summarizeModelEntries(gemmaWeightsOnly, gemmaMeta);
assert.equal(weightsRow.state, 'partial');
assert.match(weightsRow.hint, /图文件/);

const gemmaComplete = [
  ...gemmaWeightsOnly,
  {
    url: 'https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX/resolve/main/onnx/model_quantized.onnx',
    bytes: 568 * 1024,
  },
];
assert.equal(hasUsableOnnx(gemmaComplete), true);
assert.equal(summarizeModelEntries(gemmaComplete, gemmaMeta).state, 'ready');

const gemmaPartialData = [
  {
    url: 'https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX/resolve/main/onnx/model_quantized.onnx_data',
    bytes: 12 * 1024 * 1024,
  },
  {
    url: 'https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX/resolve/main/onnx/model_quantized.onnx',
    bytes: 568 * 1024,
  },
];
assert.equal(hasUsableOnnx(gemmaPartialData), false, '几 MB 的 onnx_data 不能当 Gemma 已就绪');
assert.ok(MIN_READY_ONNX_DATA > 12 * 1024 * 1024);

const gemmaRow = summarizeModelEntries(edgeNow, gemmaMeta);
assert.equal(gemmaRow.state, 'partial');
assert.equal(isModelInventoryReady(gemmaRow), false);

const miniRow = summarizeModelEntries(edgeNow, miniMeta);
assert.equal(miniRow.state, 'leftover');
assert.equal(isModelInventoryReady(miniRow), false);

const readyRow = summarizeModelEntries(
  [{
    url: 'https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX/resolve/main/onnx/model_quantized.onnx',
    bytes: MIN_READY_ONNX + 1,
  }],
  gemmaMeta,
);
assert.equal(readyRow.state, 'ready');
assert.equal(isModelInventoryReady(readyRow), true);
assert.equal(isModelInventoryReady(summarizeModelEntries([], bundledMeta)), true);

const inv = buildModelInventory(edgeNow);
assert.equal(inv.orphans.length, 1);
assert.ok(inv.leftoverBytes > 200 * 1024 * 1024);

{
  const prev = globalThis.fetch;
  let localHits = 0;
  globalThis.fetch = async (input) => {
    localHits += 1;
    return new Response(String(input));
  };
  const restore = installCacheOnlyFetch();
  try {
    await assert.rejects(
      () => globalThis.fetch('https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX/resolve/main/onnx/model.onnx'),
      (e) => String(e?.message || e).includes('模型未下载'),
    );
    await globalThis.fetch('chrome-extension://abc/vendor/transformers/ort.wasm');
    assert.equal(localHits, 1, '扩展包地址仍走本地 fetch');
    assert.equal(MODEL_NOT_DOWNLOADED.includes('模型未下载'), true);
  } finally {
    restore();
    globalThis.fetch = prev;
  }
}

{
  const broken = {
    body: null,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'x-a': '1' }),
    arrayBuffer: async () => new Uint8Array([9, 8, 7]).buffer,
  };
  const fixed = await responseWithReadableBody(broken);
  assert.ok(fixed.body, '空 body 的 Response 应补成可读流');
  assert.equal(fixed.status, 200);
  assert.deepEqual([...new Uint8Array(await fixed.arrayBuffer())], [9, 8, 7]);
}

console.log('browserModelCache ok');
