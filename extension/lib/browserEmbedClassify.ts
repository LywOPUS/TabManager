import {
  canonicalSite,
  isJunkGroupName,
  isTemplateSite,
  majoritySite,
  nameTemplateGroup,
  pathOwner,
  siteLabel,
  type LabelTab,
} from './groupLabels.js';
import {
  DEFAULT_BROWSER_MODEL,
  getBrowserModelMeta,
  getClusterParams,
  MINILM_CLUSTER,
  type BrowserModelMeta,
  type ClusterParams,
} from './browserModels.js';
import {
  MODEL_NOT_DOWNLOADED,
  accumulateDownloadProgress,
  formatDownloadStatus,
  formatLoadStatus,
  installCacheOnlyFetch,
  installStreamableCacheMatch,
  cachedModelHost,
  isBrowserModelCacheReady,
  listCachedDtypes,
  purgeLeftoverModelCache,
} from './browserModelCache.js';
import { ensureModelHostPermission, pickModelRemoteHost } from './browserModelHost.js';
import { canUseOffscreen, inPopupPage, inServiceWorker, offscreenRpc, shouldOffloadModel } from './offscreenRuntime.js';
import { isRecord } from './unknown.js';

type EmbedTab = LabelTab

type EmbedGroup = {
  key: string
  name: string
  tabIds: Array<string | number | undefined>
  tabs: EmbedTab[]
}

type EmbedPreview = {
  groups: EmbedGroup[]
  ungrouped: EmbedTab[]
}

type EmbedStatusFn = (text: string, detail?: unknown) => void

type DownloadFileProgress = { loaded: number; total: number; done: boolean }

type ProgressEvent = {
  status?: string
  file?: string
  name?: string
  total?: number
  loaded?: number
  progress?: number
}

type ExtractorOpts = {
  onStatus?: EmbedStatusFn
  preferWebGPU?: boolean
  allowDownload?: boolean
}

type PreloadOpts = {
  preferWebGPU?: boolean
  onStatus?: EmbedStatusFn
}

type ClassifyOpts = {
  onStatus?: EmbedStatusFn
  modelId?: string
  preferWebGPU?: boolean
  allowDownload?: boolean
}

type TransformersEnvOpts = {
  modelPath?: string
  wasmPaths?: string
  allowRemote?: boolean
  remoteHost?: string
}

type OnnxBackend = {
  wasm?: { wasmPaths?: string }
}

type TransformersEnv = {
  allowLocalModels?: boolean
  localModelPath?: string
  allowRemoteModels?: boolean
  useBrowserCache?: boolean
  remoteHost?: string
  backends?: { onnx?: OnnxBackend }
}

type FeatureExtractor = (
  texts: string | string[],
  opts?: { pooling?: string; normalize?: boolean },
) => Promise<{ tolist: () => number[][] }>

type AgglomCluster = { members: EmbedTab[]; vecs: ArrayLike<number>[] }

type TransformersModule = {
  pipeline: (
    task: string,
    model: string,
    opts?: {
      device?: string
      dtype?: string
      progress_callback?: (p: ProgressEvent) => void
    },
  ) => Promise<FeatureExtractor>
  env: TransformersEnv
}

// ponytail: WebGPU 优先（fp16），失败回退 WASM q8
let extractorPromise: Promise<FeatureExtractor> | null = null;
let loadedKey: string | null = null;
let lastDevice = 'wasm';

// WebGPU 失败记忆：fp16 + q8 双下载只允许发生一次，之后（含跨会话）直接走 WASM。
// 7 天 TTL 自动重试，防止驱动/浏览器升级后永远用不了 WebGPU。
const WEBGPU_DEAD_KEY = 'webgpuDeadUntil';
const WEBGPU_DEAD_TTL = 7 * 24 * 3600 * 1000;
const webgpuDeadSession = new Set<string>();

function parseDeadUntilMap(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(n) && n > 0) out[key] = n;
  }
  return out;
}

async function isWebgpuDead(id: string) {
  if (webgpuDeadSession.has(id)) return true;
  try {
    const o = await chrome.storage.local.get(WEBGPU_DEAD_KEY);
    const until = parseDeadUntilMap(o[WEBGPU_DEAD_KEY])[id] || 0;
    if (until > Date.now()) {
      webgpuDeadSession.add(id);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

async function markWebgpuDead(id: string) {
  webgpuDeadSession.add(id);
  try {
    const o = await chrome.storage.local.get(WEBGPU_DEAD_KEY);
    const m = parseDeadUntilMap(o[WEBGPU_DEAD_KEY]);
    m[id] = Date.now() + WEBGPU_DEAD_TTL;
    await chrome.storage.local.set({ [WEBGPU_DEAD_KEY]: m });
  } catch {
    /* ignore */
  }
}

export function getLastEmbedDevice() {
  return lastDevice;
}

/** 卸掉内存里的 extractor，删缓存后下次才能重新加载 */
export function unloadBrowserModel() {
  extractorPromise = null;
  loadedKey = null;
  if (canUseOffscreen()) {
    void offscreenRpc('unload').catch(() => {});
  }
}

function createProgressTracker(onStatus: EmbedStatusFn | undefined) {
  const files = new Map<string, DownloadFileProgress>();
  return (p: ProgressEvent | null | undefined) => {
    if (!p || (p.status !== 'progress' && p.status !== 'done' && p.status !== 'download')) return;
    try {
      const sum = accumulateDownloadProgress(files, p);
      onStatus?.(sum.complete ? formatLoadStatus(sum) : formatDownloadStatus(sum), {
        phase: sum.complete ? 'loading' : 'download',
        pct: sum.pct,
        loaded: sum.loaded,
        total: sum.total,
        filesDone: sum.done,
        filesTotal: sum.count,
        file: sum.file,
      });
    } catch {
      /* 进度进 transformers，抛出会中断读文件 */
    }
  };
}

function pipelineProgress(allowDownload: boolean, onStatus?: EmbedStatusFn) {
  return allowDownload ? { progress_callback: createProgressTracker(onStatus) } : {}
}

/** UI 用：当前页是否已有可用的 extractor（内存热缓存） */
export function getBrowserModelWarmState(modelId?: string, preferWebGPU = true) {
  const id = modelId || DEFAULT_BROWSER_MODEL;
  const key = `${id}|gpu:${preferWebGPU ? 1 : 0}`;
  return {
    warm: !!(extractorPromise && loadedKey === key),
    loadedKey,
    lastDevice,
    webgpuDead: webgpuDeadSession.has(id),
  };
}

/**
 * 配置 transformers 环境。
 * 注意：onnx 后端对象是惰性创建的——pipeline 首次调用时才执行
 * `env.backends.onnx = ort.env`（会覆盖事先写入的对象），
 * 因此 wasmPaths 用 setter 注入，确保落到真正的 ort env 上。
 */
export function configureTransformersEnv(env: TransformersEnv, opts: TransformersEnvOpts = {}) {
  installStreamableCacheMatch();
  const {
    modelPath,
    wasmPaths,
    allowRemote = true,
    remoteHost,
  } = opts;
  env.allowLocalModels = !!modelPath;
  if (modelPath) env.localModelPath = modelPath;
  env.allowRemoteModels = allowRemote;
  env.useBrowserCache = true;
  if (remoteHost) env.remoteHost = remoteHost;
  if (!wasmPaths) return;
  env.backends = env.backends || {};
  let onnxEnv = env.backends.onnx;
  try {
    if (onnxEnv?.wasm) onnxEnv.wasm.wasmPaths = wasmPaths;
  } catch {
    /* ignore */
  }
  Object.defineProperty(env.backends, 'onnx', {
    configurable: true,
    enumerable: true,
    get: () => onnxEnv,
    set: (v: OnnxBackend) => {
      onnxEnv = v;
      try {
        if (onnxEnv?.wasm) onnxEnv.wasm.wasmPaths = wasmPaths;
      } catch {
        /* ignore */
      }
    },
  });
}

export async function probeWebGPU() {
  try {
    if (!navigator.gpu) return false;
    const adapter = await navigator.gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

async function getExtractor(modelId: string | undefined, opts: ExtractorOpts = {}) {
  const { onStatus, preferWebGPU = true, allowDownload = false } = opts;
  const id = modelId || DEFAULT_BROWSER_MODEL;
  const key = `${id}|gpu:${preferWebGPU ? 1 : 0}`;
  if (extractorPromise && loadedKey === key) return extractorPromise;
  loadedKey = key;
  extractorPromise = (async () => {
    try {
      return await loadExtractor(id, { onStatus, preferWebGPU, allowDownload });
    } catch (e) {
      // 失败不缓存：下次调用可以重试（否则一次网络抖动就把模型判死刑）
      if (loadedKey === key) {
        extractorPromise = null;
        loadedKey = null;
      }
      throw e;
    }
  })();
  return extractorPromise;
}

async function loadExtractor(id: string, opts: ExtractorOpts = {}) {
    const { onStatus, preferWebGPU, allowDownload = false } = opts;
    if (inServiceWorker()) {
      throw new Error('Service Worker 不能加载模型');
    }
    const meta = getBrowserModelMeta(id);
    if (!meta.bundled && !allowDownload) {
      const ready = await isBrowserModelCacheReady(id);
      if (!ready) throw new Error(MODEL_NOT_DOWNLOADED);
    }

    const mod: TransformersModule = await import(
      chrome.runtime.getURL('vendor/transformers/transformers.web.min.js')
    );
    const { pipeline, env } = mod;
    let remoteHost: string | undefined;
    if (!meta.bundled) {
      remoteHost = await cachedModelHost(id);
      if (allowDownload && !remoteHost) {
        const ok = await ensureModelHostPermission();
        if (!ok) throw new Error('未授予模型下载权限（huggingface.co / hf-mirror.com）');
        onStatus?.('探测模型源…', { phase: 'checking' });
        remoteHost = await pickModelRemoteHost();
      }
      if (allowDownload) {
        onStatus?.(`从 ${(remoteHost || 'huggingface.co').replace(/^https:\/\//, '')} 拉取…`, { phase: 'download' });
      }
    }
    // 远程模型的缓存按 huggingface URL 存；allowRemote 必须开，否则整理时读不到已下载文件。
    configureTransformersEnv(env, {
      modelPath: meta.bundled ? chrome.runtime.getURL('vendor/models/') : undefined,
      wasmPaths: chrome.runtime.getURL('vendor/transformers/'),
      allowRemote: !meta.bundled,
      remoteHost,
    });
    const progress = pipelineProgress(allowDownload, onStatus);
    const restoreFetch = !meta.bundled && !allowDownload ? installCacheOnlyFetch() : () => {};

    try {
      // 内置：扩展包 q8，不走远程。
      // 远程模型：已有完整 fp16 且 GPU 可用才上 WebGPU；否则只下/用 q8。
      if (!meta.bundled) {
        const dtypes: string[] = await listCachedDtypes(id);
        const wantGpu = preferWebGPU && !(await isWebgpuDead(id)) && (await probeWebGPU());
        const ready = await isBrowserModelCacheReady(id);
        if (wantGpu && dtypes.includes('fp16') && ready) {
          try {
            onStatus?.(`加载 ${meta.label} · WebGPU（本地缓存）…`, { phase: 'loading' });
            const pipe = await pipeline('feature-extraction', id, {
              device: 'webgpu',
              dtype: 'fp16',
              ...progress,
            });
            lastDevice = 'webgpu';
            return pipe;
          } catch (e) {
            console.warn('WebGPU embed failed, fallback wasm', e);
            onStatus?.('WebGPU 失败，改用量化版…', { phase: 'loading' });
            await markWebgpuDead(id);
          }
        }
      }

      const cached = meta.bundled ? true : await isBrowserModelCacheReady(id);
      if (!cached && !allowDownload) throw new Error(MODEL_NOT_DOWNLOADED);
      onStatus?.(
        meta.bundled
          ? `加载 ${meta.label}（内置）…`
          : cached
            ? `加载 ${meta.label}（本地缓存）…`
            : `下载 ${meta.label}（量化版，约一次）…`,
        { phase: cached || meta.bundled ? 'loading' : 'download' },
      );
      const pipe = await pipeline('feature-extraction', id, {
        dtype: 'q8',
        ...progress,
      });
      lastDevice = 'wasm';
      return pipe;
    } finally {
      restoreFetch();
    }
}

function cosine(a: ArrayLike<number>, b: ArrayLike<number>) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d ? dot / d : 0;
}

const PATH_SKIP = new Set<string>([
  'watch', 'status', 'p', 'reel', 'reels', 'shorts', 'video', 't', 'i',
  'home', 'explore', 'search', 'login', 'signup', 'share', 'intent',
]);

function usefulPathWords(url: string | undefined) {
  try {
    const parts = new URL(String(url || '')).pathname.split('/').filter(Boolean);
    const out: string[] = [];
    for (const raw of parts) {
      let s = raw;
      try {
        s = decodeURIComponent(raw);
      } catch {
        /* keep raw */
      }
      const low = s.toLowerCase();
      if (PATH_SKIP.has(low)) continue;
      // YouTube / 短哈希：无主题信号
      if (/^[A-Za-z0-9_-]{10,12}$/.test(s) && /[0-9]/.test(s) && /[A-Za-z]/.test(s)) continue;
      if (!/^[A-Za-z][\w-]{2,24}$/.test(s)) continue;
      out.push(s);
      if (out.length >= 3) break;
    }
    return out.join(' ');
  } catch {
    return '';
  }
}

function isUrlTitle(title: string | undefined) {
  const s = String(title || '').trim();
  return /^https?:\/\//i.test(s);
}

function titleForEmbed(item: EmbedTab | null | undefined) {
  const t = String(item?.title || '').trim();
  if (!t || isUrlTitle(t)) return '';
  return t.slice(0, 120);
}

function embedText(item: EmbedTab | null | undefined, prefix = '', prefixMinBody = 0) {
  // 不把域名/协议写进文本，否则未加载页会聚成「Http」。
  // handle / 有意义的路径段（/docs/react）才带主题。
  const owner = pathOwner(item);
  const pathWords = usefulPathWords(item?.url);
  const title = titleForEmbed(item);
  const body = `${title} ${owner} ${pathWords}`.trim() || 'tab';
  if (!prefix || (prefixMinBody > 0 && body.length < prefixMinBody)) return body;
  return prefix + body;
}

// ---------------------------------------------------------------------------
// 主题命名：区分度关键词（簇内高频 × 全局低频），域名占绝对多数时才是站点组
// ---------------------------------------------------------------------------

const CJK_STOP = new Set<string>([
  '的', '了', '在', '是', '和', '与', '及', '或',
  '一个', '使用', '怎么', '如何', '什么', '官网', '官方', '首页',
  '登录', '注册', '页面', '标签', '浏览器', '最新', '大全', '教程',
]);

function tokenize(text: string | undefined) {
  const tokens: string[] = [];
  for (const m of String(text || '').matchAll(/[A-Za-z][A-Za-z0-9+#._-]{1,20}/g)) {
    tokens.push(m[0].toLowerCase());
  }
  for (const m of String(text || '').matchAll(/[一-鿿]{2,}/g)) {
    const run = m[0];
    for (let i = 0; i + 2 <= run.length; i += 1) tokens.push(run.slice(i, i + 2));
  }
  return tokens.filter((t) => !CJK_STOP.has(t) && !isJunkGroupName(t));
}

function docFreq(itemTokensList: Iterable<Iterable<string>>) {
  const df = new Map<string, number>();
  for (const set of itemTokensList) {
    for (const t of set) df.set(t, (df.get(t) || 0) + 1);
  }
  return df;
}

function stripTitleDecor(t: string | undefined) {
  let s = String(t || '').trim();
  s = s.replace(/^\(\d+\)\s*/, '');
  s = s.replace(/\s+[-|—–·:：/][^-|—–·:：/]{1,30}$/, '').trim();
  return s;
}

function cleanTitle(t: string | undefined) {
  return stripTitleDecor(t).slice(0, 24) || '分组';
}

/** 标题残词：不能当组名（How Kingdom Was Made → 不要叫 Was） */
const WEAK_NAME = new Set<string>([
  ...CJK_STOP,
  'was', 'how', 'best', 'why', 'what', 'when', 'your', 'own', 'made', 'make',
  'hours', 'hour', 'video', 'watch', 'youtube', 'this', 'that', 'with', 'from',
  'into', 'over', 'only', 'just', 'more', 'most', 'first', 'new', 'game', 'games',
  'play', 'plays', 'part', 'full', 'official', 'trailer', 'teaser', 'mix',
  'ultimate', 'introduction', 'intro', 'keep', 'thinking',
  'http', 'https', 'www', 'com', 'org', 'net', 'html', 'htm',
]);

function isWeakNameToken(tok: string | undefined) {
  const s = String(tok || '').trim();
  if (!s || isJunkGroupName(s) || WEAK_NAME.has(s.toLowerCase())) return true;
  if (/^[a-z]{1,3}$/i.test(s)) return true;
  if (/^https?:\/\//i.test(s)) return true;
  return false;
}

function isShellTab(item: EmbedTab | null | undefined) {
  const title = String(item?.title || '').trim();
  const usable = title && !isUrlTitle(title);
  if (usable) {
    const core = cleanTitle(title).toLowerCase();
    if (!core || core === '分组') return true;
    if (['youtube', 'x', 'twitter', '主页', 'home', 'gmail', 'google'].includes(core)) return true;
    if (/^(主页|home)\s*\/\s*x$/i.test(title)) return true;
    return false;
  }
  // 标题空或就是网址：没有作者/路径主题就不要进聚类，避免堆成 Http
  return !pathOwner(item) && !usefulPathWords(item?.url);
}

function nameCluster(
  members: EmbedTab[],
  globalDf: Map<string, number>,
  totalItems: number,
  centralTitle: string | undefined,
) {
  const site = majoritySite(members);
  if (site && isTemplateSite(site)) {
    const named = nameTemplateGroup(site, members, '');
    if (named && named !== siteLabel(site) && !isJunkGroupName(named)) return named;
  }

  const local = new Map<string, number>();
  for (const m of members) {
    const toks = new Set<string>(tokenize(stripTitleDecor(m.title)));
    for (const t of toks) local.set(t, (local.get(t) || 0) + 1);
  }
  let best: string | null = null;
  let bestScore = 0;
  for (const [tok, ln] of local) {
    if (ln < 2 || isWeakNameToken(tok)) continue;
    if (site && (tok === site || tok === canonicalSite(site))) continue;
    const gn = globalDf.get(tok) || 0;
    const outsideN = Math.max(0, totalItems - members.length);
    if (outsideN >= 4 && (gn - ln) / outsideN > 0.5) continue;
    const score = (ln / Math.max(1, gn)) * Math.log(1 + ln);
    if (score > bestScore) {
      bestScore = score;
      best = tok;
    }
  }
  if (best) {
    const named = /^[a-z]/.test(best) ? best.charAt(0).toUpperCase() + best.slice(1) : best;
    return named.slice(0, 20);
  }

  const central = cleanTitle(centralTitle || members[0]?.title);
  if (central && central !== '分组' && !isUrlTitle(central) && !isWeakNameToken(central)) {
    return central;
  }

  if (site && !isTemplateSite(site) && majoritySite(members, 0.8)) {
    return siteLabel(site) || site;
  }
  return '主题';
}

// ---------------------------------------------------------------------------
// 聚类：全部标签一次嵌入 → 全局凝聚式（average linkage）→ 分位数阈值
// 套话站（X 等）也进模型；不像的留未分组，不再整站收成「X」。
// ---------------------------------------------------------------------------

const EMBED_BATCH = 16;

function quantile(sorted: number[], q: number) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[i] ?? 0;
}

/** 预计算桶内 n×n 相似度矩阵（含模长归一化，与 cosine 等价）。O(n²·dim) 一次算清 */
function buildSimMatrix(vecs: ArrayLike<number>[]) {
  const n = vecs.length;
  const m = new Float32Array(n * n);
  const norms = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    let s = 0;
    const vi = vecs[i];
    if (!vi) continue;
    for (let k = 0; k < vi.length; k += 1) s += vi[k] * vi[k];
    norms[i] = Math.sqrt(s) || 1;
  }
  for (let i = 0; i < n; i += 1) {
    m[i * n + i] = 1;
    const vi = vecs[i];
    if (!vi) continue;
    for (let j = i + 1; j < n; j += 1) {
      const vj = vecs[j];
      if (!vj) continue;
      let dot = 0;
      for (let k = 0; k < vi.length; k += 1) dot += vi[k] * vj[k];
      const sim = dot / ((norms[i] || 1) * (norms[j] || 1));
      m[i * n + j] = sim;
      m[j * n + i] = sim;
    }
  }
  return m;
}

/**
 * 凝聚式平均连接（Lance-Williams）：维护簇间相似度之和 sum，
 * avg(i,j) = sum(i,j) / (|i|·|j|)，合并后 sum(i,k) += sum(j,k) 增量更新。
 * 每轮合并 O(n²) 纯数组扫描，总 O(n³) 但常数极小；矩阵内存 O(n²)。
 * 旧实现每轮全量重算向量叉乘，400 标签大桶约 1e10 次乘法，UI 冻结数十秒。
 */
function agglomerative(items: EmbedTab[], vectors: ArrayLike<number>[], simMatrix: ArrayLike<number>, threshold: number) {
  const n = items.length;
  const clusters: Array<AgglomCluster | null> = items.map((it, i) => ({ members: [it], vecs: [vectors[i] || []] }));
  // sum[c1*n+c2] = 簇 c1 与簇 c2 的成员相似度之和（初始为单例相似度）
  const sum = Float32Array.from(simMatrix);
  for (;;) {
    let best = threshold;
    let bi = -1;
    let bj = -1;
    for (let i = 0; i < n; i += 1) {
      const ci = clusters[i];
      if (!ci) continue;
      const si = ci.members.length;
      for (let j = i + 1; j < n; j += 1) {
        const cj = clusters[j];
        if (!cj) continue;
        const avg = sum[i * n + j] / (si * cj.members.length);
        if (avg > best) {
          best = avg;
          bi = i;
          bj = j;
        }
      }
    }
    if (bi < 0) break;
    const merged = clusters[bi];
    const dropped = clusters[bj];
    if (!merged || !dropped) break;
    for (let k = 0; k < n; k += 1) {
      if (k === bi || k === bj || !clusters[k]) continue;
      sum[bi * n + k] += sum[bj * n + k];
      sum[k * n + bi] = sum[bi * n + k];
    }
    merged.members.push(...dropped.members);
    merged.vecs.push(...dropped.vecs);
    clusters[bj] = null;
  }
  return clusters.filter((c): c is AgglomCluster => c != null);
}

/** 簇中心成员（命名兜底用） */
function centralMember(cluster: AgglomCluster) {
  // 平均向量当质心
  const firstVec = cluster.vecs[0];
  if (!firstVec) return cluster.members[0];
  const dim = firstVec.length;
  const centroid = new Float32Array(dim);
  for (const v of cluster.vecs) for (let k = 0; k < dim; k += 1) centroid[k] += v[k] / cluster.vecs.length;
  let central = cluster.members[0];
  let bestSim = -1;
  for (let i = 0; i < cluster.members.length; i += 1) {
    const vec = cluster.vecs[i];
    if (!vec) continue;
    const sim = cosine(vec, centroid);
    if (sim > bestSim) {
      bestSim = sim;
      central = cluster.members[i];
    }
  }
  return central;
}

function pushGroup(groups: EmbedGroup[], usedNames: Set<string>, name: string, members: EmbedTab[]) {
  let finalName = name;
  for (let i = 2; usedNames.has(finalName); i += 1) finalName = `${name} · ${i}`;
  usedNames.add(finalName);
  groups.push({
    key: finalName,
    name: finalName,
    tabIds: members.map((t) => t.id),
    tabs: members,
  });
}

function clusterParamsOf(cluster: ClusterParams): ClusterParams {
  const meta: BrowserModelMeta = {
    id: DEFAULT_BROWSER_MODEL,
    label: '',
    note: '',
    cluster,
  };
  return getClusterParams(meta);
}

/** 已有向量时的全局聚类（单测 / 调试） */
export function clusterPreview(items: EmbedTab[], vectors: ArrayLike<number>[], cluster: ClusterParams = MINILM_CLUSTER): EmbedPreview {
  const groups: EmbedGroup[] = [];
  const ungrouped: EmbedTab[] = [];
  const usedNames = new Set<string>();
  if (!items.length) return { groups, ungrouped };
  const { floor, q, cap } = clusterParamsOf(cluster);
  const globalDf = docFreq(items.map((t) => new Set(tokenize(stripTitleDecor(t.title)))));
  const simMatrix = buildSimMatrix(vectors);
  const sims: number[] = [];
  const n = items.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) sims.push(simMatrix[i * n + j] ?? 0);
  }
  sims.sort((a, b) => a - b);
  const threshold = Math.max(floor, Math.min(cap, quantile(sims, q)));
  const clusters = agglomerative(items, vectors, simMatrix, threshold);
  for (const c of clusters) {
    if (c.members.length < 2) {
      ungrouped.push(...c.members);
      continue;
    }
    const name = nameCluster(c.members, globalDf, items.length, centralMember(c)?.title);
    pushGroup(groups, usedNames, name, c.members);
  }
  groups.sort((a, b) => b.tabs.length - a.tabs.length || a.name.localeCompare(b.name, 'zh'));
  return { groups, ungrouped };
}

export async function preloadBrowserModel(modelId?: string, opts: PreloadOpts = {}) {
  const { preferWebGPU = true, onStatus } = opts;
  if (inPopupPage()) throw new Error(MODEL_NOT_DOWNLOADED);
  const id = typeof modelId === 'string' ? modelId : undefined;
  const meta = getBrowserModelMeta(id || DEFAULT_BROWSER_MODEL);
  if (shouldOffloadModel(meta)) {
    try {
      await offscreenRpc('preload', { modelId: id, opts: { preferWebGPU } }, onStatus);
      return true;
    } catch (e) {
      if (inServiceWorker()) throw e;
      const raw = e instanceof Error ? e.message : String(e);
      if (!/无法启动|未就绪|Receiving end|offscreen/i.test(raw)) throw e;
      console.warn('offscreen preload fallback', e);
    }
  }
  await getExtractor(id, { onStatus, preferWebGPU, allowDownload: true });
  try {
    await purgeLeftoverModelCache(id);
  } catch {
    /* 量化版已就绪，清残留失败不挡用 */
  }
  return true;
}

function parseLabelTab(value: Record<string, unknown>): EmbedTab {
  const tab: EmbedTab = {};
  if (typeof value.id === 'string' || typeof value.id === 'number') tab.id = value.id;
  if (typeof value.tabId === 'string' || typeof value.tabId === 'number') tab.tabId = value.tabId;
  if (typeof value.title === 'string') tab.title = value.title;
  if (typeof value.url === 'string') tab.url = value.url;
  return tab;
}

function toEmbedTabs(items: unknown): EmbedTab[] {
  if (!Array.isArray(items)) return [];
  const out: EmbedTab[] = [];
  for (const item of items) out.push(isRecord(item) ? parseLabelTab(item) : {});
  return out;
}

function parseEmbedGroup(value: unknown): EmbedGroup | null {
  if (!isRecord(value)) return null;
  const name = typeof value.name === 'string' ? value.name : '';
  const key = typeof value.key === 'string' ? value.key : name;
  const tabs: EmbedTab[] = [];
  if (Array.isArray(value.tabs)) {
    for (const t of value.tabs) tabs.push(isRecord(t) ? parseLabelTab(t) : {});
  }
  const tabIds: Array<string | number | undefined> = [];
  if (Array.isArray(value.tabIds)) {
    for (const id of value.tabIds) {
      if (typeof id === 'string' || typeof id === 'number' || id === undefined) tabIds.push(id);
    }
  } else {
    for (const t of tabs) tabIds.push(t.id);
  }
  return { key, name, tabs, tabIds };
}

function parseEmbedPreview(value: unknown): EmbedPreview | null {
  if (!isRecord(value)) return null;
  if (!Array.isArray(value.groups) || !Array.isArray(value.ungrouped)) return null;
  const groups: EmbedGroup[] = [];
  for (const g of value.groups) {
    const parsed = parseEmbedGroup(g);
    if (parsed) groups.push(parsed);
  }
  const ungrouped: EmbedTab[] = [];
  for (const t of value.ungrouped) ungrouped.push(isRecord(t) ? parseLabelTab(t) : {});
  return { groups, ungrouped };
}

export async function classifyWithBrowserEmbed(items?: unknown, opts: ClassifyOpts = {}): Promise<EmbedPreview> {
  const { onStatus, modelId, preferWebGPU = true } = opts;
  const tabs = toEmbedTabs(items);
  if (!tabs.length) return { groups: [], ungrouped: [] };
  const meta = getBrowserModelMeta(modelId || DEFAULT_BROWSER_MODEL);
  if (shouldOffloadModel(meta)) {
    const r = await offscreenRpc('classify', {
      items: tabs,
      opts: { modelId: meta.id, preferWebGPU, allowDownload: false },
    }, onStatus);
    if (isRecord(r)) {
      const preview = parseEmbedPreview(r.preview);
      if (preview) return preview;
    }
    return { groups: [], ungrouped: tabs };
  }

  const shells: EmbedTab[] = [];
  const work: EmbedTab[] = [];
  for (const t of tabs) {
    if (isShellTab(t)) shells.push(t);
    else work.push(t);
  }
  if (work.length < 2) {
    return { groups: [], ungrouped: [...work, ...shells] };
  }

  const extractor = await getExtractor(meta.id, { onStatus, preferWebGPU, allowDownload: false });
  const cluster = getClusterParams(meta);
  const prefix = meta.textPrefix || '';
  const texts = work.map((t) => embedText(t, prefix, cluster.prefixMinBody));
  const vectors: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const end = Math.min(i + EMBED_BATCH, texts.length);
    onStatus?.(`编码 ${i + 1}–${end}/${texts.length}（${meta.label} · ${lastDevice}）…`);
    const output = await extractor(texts.slice(i, end), { pooling: 'mean', normalize: true });
    const list = output.tolist();
    for (const row of list) vectors.push(Float32Array.from(row));
  }
  onStatus?.('按主题聚类…');
  const preview = clusterPreview(work, vectors, cluster);
  preview.ungrouped.push(...shells);
  return preview;
}

// 仅供单测/调试
export const __test__ = {
  agglomerative,
  buildSimMatrix,
  quantile,
  nameCluster,
  tokenize,
  cleanTitle,
  embedText,
  getClusterParams,
  cosine,
  centralMember,
  isShellTab,
  isWeakNameToken,
  usefulPathWords,
  isUrlTitle,
};
