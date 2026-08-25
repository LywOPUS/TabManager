/**
 * 浏览器内模型缓存：列出 / 删除 transformers-cache，并汇总多文件下载进度。
 * 已知模型 + 残留（半截、旧 fp16、对不上的 orphan）在这一份里算清。
 */
import { BROWSER_MODELS, getBrowserModelMeta, type BrowserModelMeta } from './browserModels.js';
import { formatBytes } from './tabUsage.js';

export const TRANSFORMERS_CACHE = 'transformers-cache';
export const MODEL_NOT_DOWNLOADED = '模型未下载。请到标签管理页「模型」下载后再整理。';

/** 单文件量化权重到这个体积才算能用（半截 fp16 只有几百 KB） */
export const MIN_READY_ONNX = 8 * 1024 * 1024;
/** 外挂 onnx_data（Gemma ~309MB）半截下到几 MB 不能当就绪，否则整理会去补下 */
export const MIN_READY_ONNX_DATA = 200 * 1024 * 1024;
/** 小于这个的 onnx 当半截残文件 */
export const STUB_ONNX = 1024 * 1024;

export type ModelCacheState = 'bundled' | 'ready' | 'partial' | 'leftover' | 'empty'
export type ModelCacheRow = {
  id: string
  label: string
  note: string
  bundled: boolean
  state: ModelCacheState
  bytes: number
  fileCount: number
  leftoverBytes: number
  missingGraph: boolean
  hint: string
}
export type ModelCacheOrphan = { url: string; name: string; bytes: number }
export type ModelCacheInventory = {
  models: ModelCacheRow[]
  orphans: ModelCacheOrphan[]
  leftoverBytes: number
  leftoverCount: number
  orphanBytes: number
  totalBytes: number
}

type CacheEntry = { url: string; bytes?: number }
type ModelIdRef = { id: string }
type DownloadFileProgress = { loaded: number; total: number; done: boolean }
type DownloadProgressEvent = {
  file?: string
  name?: string
  status?: string
  total?: number
  loaded?: number
  progress?: number
}
type DownloadSummary = {
  loaded: number
  total: number
  done: number
  count: number
  pct: number
  file: string
  complete: boolean
}
type ModelCacheFileInfo = {
  url: string
  name: string
  bytes: number
  dtype: string
  leftover: boolean
}
type ModelCacheRowFull = ModelCacheRow & {
  dtypes: string[]
  files: ModelCacheFileInfo[]
}

export function cacheUrlMatchesModel(url: string | undefined, modelId: string | undefined) {
  const u = String(url || '');
  const id = String(modelId || '');
  if (!u || !id) return false;
  if (u.includes(id)) return true;
  if (u.includes(encodeURIComponent(id))) return true;
  const parts = id.split('/').filter(Boolean);
  if (parts.length >= 2) {
    const org = parts[0];
    const name = parts.slice(1).join('/');
    return u.includes(`/${org}/`) && u.includes(`/${name}/`);
  }
  return false;
}

export function dtypeFromCacheUrl(url: string | undefined) {
  const u = String(url || '').toLowerCase();
  if (u.includes('fp16')) return 'fp16';
  if (u.includes('q4f16') || u.includes('q4')) return 'q4';
  if (u.includes('quantized') || u.includes('int8') || u.includes('uint8') || u.includes('q8')) {
    return 'q8';
  }
  if (/\.onnx(_data)?(\?|$)/.test(u)) return 'onnx';
  return '';
}

/** 图文件：model.onnx / model_quantized.onnx（可能只有几百 KB） */
export function isOnnxGraphUrl(url: string | undefined) {
  return /\.onnx(\?|$)/i.test(String(url || ''));
}

/** 外挂权重：model_quantized.onnx_data（Gemma 约 309MB） */
export function isOnnxDataUrl(url: string | undefined) {
  return /\.onnx_data(\?|$)/i.test(String(url || ''));
}

export function isOnnxUrl(url: string | undefined) {
  return isOnnxGraphUrl(url) || isOnnxDataUrl(url);
}

export function onnxStem(url: string | undefined) {
  return fileNameOf(url).toLowerCase().replace(/\.onnx_data$/i, '').replace(/\.onnx$/i, '');
}

/** 常见图文件名，不能当半截残留删掉 */
export function isOnnxGraphName(url: string | undefined) {
  return /^model(_quantized|_q8|_uint8|_int8)?$/.test(onnxStem(url));
}

export function hasUsableOnnx(entries: CacheEntry[] | undefined) {
  const list: CacheEntry[] = entries || [];
  const graphs = list.filter((e) => isOnnxGraphUrl(e.url) && dtypeFromCacheUrl(e.url) !== 'fp16');
  const datas = list.filter((e) => isOnnxDataUrl(e.url) && dtypeFromCacheUrl(e.url) !== 'fp16');
  if (graphs.some((g) => (g.bytes || 0) >= MIN_READY_ONNX)) return true;
  const dataByStem = new Map<string, CacheEntry>(datas.map((d) => [onnxStem(d.url), d]));
  return graphs.some((g) => {
    const d = dataByStem.get(onnxStem(g.url));
    return !!(d && (d.bytes || 0) >= MIN_READY_ONNX_DATA);
  });
}

export function missingOnnxGraph(entries: CacheEntry[] | undefined) {
  const list: CacheEntry[] = entries || [];
  const graphStems = new Set<string>(
    list.filter((e) => isOnnxGraphUrl(e.url)).map((e) => onnxStem(e.url)),
  );
  return list.filter((e) => (
    isOnnxDataUrl(e.url)
    && dtypeFromCacheUrl(e.url) !== 'fp16'
    && (e.bytes || 0) >= MIN_READY_ONNX_DATA
    && !graphStems.has(onnxStem(e.url))
  ));
}

export function accumulateDownloadProgress(
  files: Map<string, DownloadFileProgress>,
  event: DownloadProgressEvent | null | undefined,
) {
  const name = String(event?.file || event?.name || 'file');
  const prev = files.get(name) || { loaded: 0, total: 0, done: false };
  const status = event?.status;
  let total = Number(event?.total);
  if (!Number.isFinite(total) || total <= 0) total = prev.total;
  let loaded = Number(event?.loaded);
  const rawPct = Number(event?.progress);
  if (!Number.isFinite(loaded) || loaded < 0) {
    if (Number.isFinite(rawPct) && total > 0) {
      const p = rawPct > 1 ? rawPct / 100 : rawPct;
      loaded = p * total;
    } else {
      loaded = prev.loaded;
    }
  }
  if (status === 'done') {
    files.set(name, { loaded: total || loaded, total: total || loaded, done: true });
  } else {
    files.set(name, {
      loaded,
      total: total || prev.total,
      done: false,
    });
  }
  return summarizeDownload(files, name);
}

export function summarizeDownload(files: Map<string, DownloadFileProgress>, currentFile = ''): DownloadSummary {
  let loaded = 0;
  let total = 0;
  let done = 0;
  for (const f of files.values()) {
    loaded += f.loaded || 0;
    if (f.total > 0) total += f.total;
    if (f.done) done += 1;
  }
  const count = files.size;
  const bytesFull = total > 0 && loaded >= total * 0.995;
  const complete = count > 0 && (done === count || (bytesFull && done >= count - 1));
  let pct = 0;
  if (complete) pct = 100;
  else if (total > 0) pct = Math.min(99, Math.round((loaded / total) * 100));
  else if (count) pct = Math.min(99, Math.round((done / count) * 100));
  const file = String(currentFile).split('/').pop() || '';
  return { loaded, total, done, count, pct, file, complete };
}

export function formatDownloadStatus(sum: DownloadSummary) {
  const size = sum.total > 0
    ? `${formatBytes(sum.loaded)} / ${formatBytes(sum.total)}`
    : formatBytes(sum.loaded);
  const files = sum.count ? `${sum.done}/${sum.count} 个文件` : '准备文件';
  if (sum.complete) {
    return `文件已齐，正在加载模型 · ${size}`;
  }
  const which = sum.file ? ` · ${sum.file}` : '';
  return `下载中 ${sum.pct}% · ${size} · ${files}${which}`;
}

/** 整理：不提文件/下载，只说在加载 */
export function formatLoadStatus(_sum: DownloadSummary) {
  return '正在加载模型';
}

/** Cache API 有时给出 body === null 的 Response；transformers 一走 getReader 就会炸。 */
export async function responseWithReadableBody(res: Response) {
  if (res.body) return res
  const buf = await res.arrayBuffer()
  return new Response(buf, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  })
}

let streamableCacheInstalled = false

/** 让 caches.match 永远交出可读 body。只装一次。 */
export function installStreamableCacheMatch() {
  if (streamableCacheInstalled || typeof Cache === 'undefined') return
  const orig = Cache.prototype.match
  Cache.prototype.match = async function (request, options) {
    const res = await orig.call(this, request, options)
    if (!res) return res
    try {
      return await responseWithReadableBody(res)
    } catch {
      return res
    }
  }
  streamableCacheInstalled = true
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return String(input.url || '');
}

function isLocalExtensionUrl(url: string) {
  return /^(chrome-extension:|moz-extension:|blob:|data:)/i.test(url);
}

/**
 * 整理路径禁止走网络拉权重。命中 transformers-cache 才放行，否则抛 MODEL_NOT_DOWNLOADED。
 * 扩展包 / wasm 本地地址仍走原来的 fetch。
 */
export function installCacheOnlyFetch() {
  const orig = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;
  if (!orig) return () => {};
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (!url || isLocalExtensionUrl(url)) return orig(input, init);
    try {
      const cache = await openTransformersCache();
      if (cache) {
        const hit = await cache.match(url) || (input && typeof input !== 'string' ? await cache.match(input) : null);
        if (hit) return hit;
      }
    } catch {
      /* 读缓存失败 = 当没下过 */
    }
    throw new Error(MODEL_NOT_DOWNLOADED);
  };
  globalThis.fetch = wrapped;
  return () => {
    if (globalThis.fetch === wrapped) globalThis.fetch = orig;
  };
}

function fileNameOf(url: string | undefined) {
  try {
    const path = new URL(String(url || '')).pathname;
    return decodeURIComponent(path.split('/').pop() || String(url || ''));
  } catch {
    return String(url || '').split('/').pop() || '';
  }
}

/** 这条缓存要不要当残留清掉（旧 fp16 / 对不上已知模型）。图文件再小也不能删。 */
export function isLeftoverEntry(entry: CacheEntry | null | undefined, models: readonly ModelIdRef[] = BROWSER_MODELS) {
  const url = entry?.url || '';
  const bytes = Number(entry?.bytes) || 0;
  const known = models.some((m) => cacheUrlMatchesModel(url, m.id));
  if (!known) return true;
  if (dtypeFromCacheUrl(url) === 'fp16') return true;
  if (isOnnxDataUrl(url)) return false;
  if (isOnnxGraphUrl(url) && isOnnxGraphName(url)) return false;
  if (isOnnxGraphUrl(url) && bytes > 0 && bytes < STUB_ONNX) return true;
  return false;
}

export function summarizeModelEntries(
  entries: CacheEntry[],
  meta: Pick<BrowserModelMeta, 'id' | 'label' | 'note' | 'bundled'>,
): ModelCacheRowFull {
  const mine = entries.filter((e) => cacheUrlMatchesModel(e.url, meta.id));
  const bytes = mine.reduce((s, e) => s + (e.bytes || 0), 0);
  const dtypes = [...new Set(mine.map((e) => dtypeFromCacheUrl(e.url)).filter(Boolean))];
  const leftoverMine = mine.filter((e) => isLeftoverEntry(e, [meta]));
  const leftoverBytes = leftoverMine.reduce((s, e) => s + (e.bytes || 0), 0);
  const usable = hasUsableOnnx(mine);
  const missingGraph = missingOnnxGraph(mine).length > 0;

  let state: ModelCacheState = 'empty';
  if (meta.bundled) state = 'bundled';
  else if (usable) state = 'ready';
  else if (leftoverBytes > 0 && leftoverBytes >= bytes * 0.5) state = 'leftover';
  else if (mine.length) state = 'partial';

  let hint = '';
  if (state === 'bundled') hint = '内置 · 不占下载缓存';
  else if (state === 'ready' && leftoverBytes > 0) {
    hint = `已下载 ${formatBytes(bytes)} · 其中残留 ${formatBytes(leftoverBytes)}`;
  } else if (state === 'ready') hint = `已下载 ${formatBytes(bytes)}`;
  else if (state === 'leftover') {
    hint = dtypes.includes('fp16')
      ? `残留 ${formatBytes(bytes)} · 旧 WebGPU fp16，没有量化版`
      : `残留 ${formatBytes(bytes)}`;
  } else if (missingGraph) {
    hint = `权重已在（${formatBytes(bytes)}），还差约 0.6MB 图文件，点续下`;
  } else if (state === 'partial') hint = `下了一部分 ${formatBytes(bytes)} · 量化权重不完整`;
  else hint = '未下载';

  return {
    id: meta.id,
    label: meta.label,
    note: meta.note || '',
    bundled: !!meta.bundled,
    state,
    bytes,
    fileCount: mine.length,
    dtypes,
    leftoverBytes,
    missingGraph,
    hint,
    files: mine.map((e) => ({
      url: e.url,
      name: fileNameOf(e.url),
      bytes: e.bytes || 0,
      dtype: dtypeFromCacheUrl(e.url),
      leftover: isLeftoverEntry(e, [meta]),
    })),
  };
}

export function buildModelInventory(
  entries: CacheEntry[],
  models: readonly BrowserModelMeta[] = BROWSER_MODELS,
): ModelCacheInventory {
  const list = models.map((meta) => summarizeModelEntries(entries, meta));
  const orphans: ModelCacheOrphan[] = entries
    .filter((e) => !models.some((m) => cacheUrlMatchesModel(e.url, m.id)))
    .map((e) => ({
      url: e.url,
      name: fileNameOf(e.url),
      bytes: e.bytes || 0,
    }));
  const leftoverEntries = entries.filter((e) => isLeftoverEntry(e, models));
  const leftoverBytes = leftoverEntries.reduce((s, e) => s + (e.bytes || 0), 0);
  const totalBytes = entries.reduce((s, e) => s + (e.bytes || 0), 0);
  return {
    models: list,
    orphans,
    leftoverBytes,
    leftoverCount: leftoverEntries.length,
    orphanBytes: orphans.reduce((s, e) => s + (e.bytes || 0), 0),
    totalBytes,
  };
}

export function isModelInventoryReady(row: Pick<ModelCacheRow, 'state'> | null | undefined) {
  return row?.state === 'bundled' || row?.state === 'ready';
}

async function openTransformersCache() {
  if (typeof caches === 'undefined') return null;
  try {
    const names = await caches.keys();
    const hit = names.find((n) => n === TRANSFORMERS_CACHE) || names.find((n) => /transformer/i.test(n));
    if (!hit) return null;
    return caches.open(hit);
  } catch {
    return null;
  }
}

export async function listCachedDtypes(modelId: string) {
  const cache = await openTransformersCache();
  if (!cache) return [];
  const reqs = await cache.keys();
  const dtypes: string[] = [];
  for (const req of reqs) {
    if (!cacheUrlMatchesModel(req.url, modelId)) continue;
    const d = dtypeFromCacheUrl(req.url);
    if (d) dtypes.push(d);
  }
  return [...new Set(dtypes)];
}

async function readCacheEntries() {
  const cache = await openTransformersCache();
  if (!cache) return [];
  const reqs = await cache.keys();
  const out: CacheEntry[] = [];
  for (const req of reqs) {
    let bytes = 0;
    try {
      const res = await cache.match(req);
      const header = Number(res?.headers.get('content-length'));
      if (Number.isFinite(header) && header > 0) bytes = header;
      else if (res) bytes = (await res.blob()).size;
    } catch {
      bytes = 0;
    }
    out.push({ url: req.url, bytes });
  }
  return out;
}

export async function inspectBrowserModelCache() {
  return buildModelInventory(await readCacheEntries());
}

export async function listBrowserModelCache() {
  return (await inspectBrowserModelCache()).models;
}

export async function isBrowserModelCacheReady(modelId: string) {
  const meta = getBrowserModelMeta(modelId);
  if (meta.bundled) return true;
  const row = summarizeModelEntries(await readCacheEntries(), meta);
  return isModelInventoryReady(row);
}

/** 续下时跟已有缓存用同一个源，避免 hf-mirror / huggingface 各下一份 */
export async function cachedModelHost(modelId: string) {
  const id = getBrowserModelMeta(modelId).id;
  const mine = (await readCacheEntries()).filter((e) => cacheUrlMatchesModel(e.url, id));
  if (mine.some((e) => e.url.includes('hf-mirror.com'))) return 'https://hf-mirror.com';
  if (mine.some((e) => e.url.includes('huggingface.co'))) return 'https://huggingface.co';
  return '';
}

async function deleteMatching(predicate: (url: string) => boolean) {
  const cache = await openTransformersCache();
  let removed = 0;
  let bytes = 0;
  if (!cache) return { ok: true, removed, bytes };
  const entries = await readCacheEntries();
  const reqs = await cache.keys();
  const byUrl = new Map<string, number>(entries.map((e) => [e.url, e.bytes || 0]));
  for (const req of reqs) {
    if (!predicate(req.url)) continue;
    await cache.delete(req);
    removed += 1;
    bytes += byUrl.get(req.url) || 0;
  }
  return { ok: true, removed, bytes };
}

export async function deleteBrowserModelCache(modelId: string) {
  const id = getBrowserModelMeta(modelId).id;
  return deleteMatching((url) => cacheUrlMatchesModel(url, id));
}

/** 清半截、旧 fp16、对不上已知模型的条目；留下能用的量化版 */
export async function purgeLeftoverModelCache(modelId?: string) {
  const entries = await readCacheEntries();
  const drop = new Set<string>(
    entries
      .filter((e) => {
        if (modelId && !cacheUrlMatchesModel(e.url, getBrowserModelMeta(modelId).id)) return false;
        return isLeftoverEntry(e, BROWSER_MODELS);
      })
      .map((e) => e.url),
  );
  return deleteMatching((url) => drop.has(url));
}

export const __test__ = {
  cacheUrlMatchesModel,
  dtypeFromCacheUrl,
  isOnnxUrl,
  isOnnxGraphUrl,
  isOnnxDataUrl,
  isOnnxGraphName,
  hasUsableOnnx,
  missingOnnxGraph,
  isLeftoverEntry,
  summarizeModelEntries,
  buildModelInventory,
  isModelInventoryReady,
  accumulateDownloadProgress,
  summarizeDownload,
  formatDownloadStatus,
  formatLoadStatus,
  installCacheOnlyFetch,
  responseWithReadableBody,
};
