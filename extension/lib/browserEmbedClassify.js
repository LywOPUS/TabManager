import { registrableDomain } from './groupHeuristics.js';
import { DEFAULT_BROWSER_MODEL, getBrowserModelMeta } from './browserModels.js';

// ponytail: WebGPU 优先（fp16），失败回退 WASM q8
let extractorPromise = null;
let loadedKey = null;
let lastDevice = 'wasm';

// WebGPU 失败记忆：fp16 + q8 双下载只允许发生一次，之后（含跨会话）直接走 WASM。
// 7 天 TTL 自动重试，防止驱动/浏览器升级后永远用不了 WebGPU。
const WEBGPU_DEAD_KEY = 'webgpuDeadUntil';
const WEBGPU_DEAD_TTL = 7 * 24 * 3600 * 1000;
const webgpuDeadSession = new Set();

async function isWebgpuDead(id) {
  if (webgpuDeadSession.has(id)) return true;
  try {
    const o = await chrome.storage.local.get(WEBGPU_DEAD_KEY);
    const until = o?.[WEBGPU_DEAD_KEY]?.[id] || 0;
    if (until > Date.now()) {
      webgpuDeadSession.add(id);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

async function markWebgpuDead(id) {
  webgpuDeadSession.add(id);
  try {
    const o = await chrome.storage.local.get(WEBGPU_DEAD_KEY);
    const m = o?.[WEBGPU_DEAD_KEY] || {};
    m[id] = Date.now() + WEBGPU_DEAD_TTL;
    await chrome.storage.local.set({ [WEBGPU_DEAD_KEY]: m });
  } catch {
    /* ignore */
  }
}

export function getLastEmbedDevice() {
  return lastDevice;
}

/** UI 用：当前页是否已有可用的 extractor（内存热缓存） */
export function getBrowserModelWarmState(modelId, preferWebGPU = true) {
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
export function configureTransformersEnv(env, { modelPath, wasmPaths, allowRemote = true } = {}) {
  env.allowLocalModels = true;
  if (modelPath) env.localModelPath = modelPath;
  env.allowRemoteModels = allowRemote;
  env.useBrowserCache = true;
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
    set: (v) => {
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

async function getExtractor(modelId, { onStatus, preferWebGPU = true } = {}) {
  const id = modelId || DEFAULT_BROWSER_MODEL;
  const key = `${id}|gpu:${preferWebGPU ? 1 : 0}`;
  if (extractorPromise && loadedKey === key) return extractorPromise;
  loadedKey = key;
  extractorPromise = (async () => {
    try {
      return await loadExtractor(id, { onStatus, preferWebGPU });
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

async function loadExtractor(id, { onStatus, preferWebGPU } = {}) {
    const meta = getBrowserModelMeta(id);
    const mod = await import(
      chrome.runtime.getURL('vendor/transformers/transformers.web.min.js')
    );
    const { pipeline, env } = mod;
    // 内置模型本地加载；其余模型走远程 + 浏览器缓存
    configureTransformersEnv(env, {
      modelPath: chrome.runtime.getURL('vendor/models/'),
      wasmPaths: chrome.runtime.getURL('vendor/transformers/'),
      allowRemote: true,
    });

    const onProgress = (p) => {
      if (p?.status === 'progress' && p.file && Number.isFinite(p.progress)) {
        onStatus?.(`下载 ${p.file.split('/').pop()} ${Math.floor(p.progress)}%`);
      }
    };

    // 内置模型直接 WASM q8 本地加载（无 fp16 文件，WebGPU 尝试只会触发远程下载）
    if (!meta.bundled) {
      // WebGPU 失败记忆：避免每次整理都白下一遍 fp16
      const wantGpu = preferWebGPU && !(await isWebgpuDead(id)) && (await probeWebGPU());
      if (wantGpu) {
        try {
          // WebGPU 上 q8 易不准/不稳，用 fp16（文档推荐）
          onStatus?.(`加载 ${meta.label} · WebGPU…`);
          const pipe = await pipeline('feature-extraction', id, {
            device: 'webgpu',
            dtype: 'fp16',
            progress_callback: onProgress,
          });
          lastDevice = 'webgpu';
          return pipe;
        } catch (e) {
          console.warn('WebGPU embed failed, fallback wasm', e);
          onStatus?.('WebGPU 失败，回退 WASM（7 天内不再尝试 WebGPU）…');
          await markWebgpuDead(id);
        }
      }
    }

    onStatus?.(`加载 ${meta.label}${meta.bundled ? '（内置）' : ' · WASM'}…`);
    const pipe = await pipeline('feature-extraction', id, {
      dtype: 'q8',
      progress_callback: onProgress,
    });
    lastDevice = 'wasm';
    return pipe;
}

function cosine(a, b) {
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

function embedText(item, prefix = '') {
  // 注意：不要把域名放进编码文本——实测同域不同主题相似度会被域名拉高，
  // 导致聚类退化成按站点分组。域名先验由"域名分桶"显式承担。
  // URL 路径里的英文词常带主题信号（/docs/react、/tags/travel）
  let pathWords = '';
  try {
    pathWords = new URL(item.url)
      .pathname.split('/')
      .filter((s) => /^[A-Za-z][\w-]{2,24}$/.test(s))
      .slice(0, 3)
      .join(' ');
  } catch {
    /* ignore */
  }
  const title = (item.title || '').slice(0, 120);
  const body = `${title} ${pathWords}`.trim() || item.url || 'tab';
  return prefix + body;
}

// ---------------------------------------------------------------------------
// 主题命名：区分度关键词（簇内高频 × 全局低频），域名占绝对多数时才是站点组
// ---------------------------------------------------------------------------

const CJK_STOP = new Set([
  '的', '了', '在', '是', '和', '与', '及', '或',
  '一个', '使用', '怎么', '如何', '什么', '官网', '官方', '首页',
  '登录', '注册', '页面', '标签', '浏览器', '最新', '大全', '教程',
]);

function tokenize(text) {
  const tokens = [];
  for (const m of String(text || '').matchAll(/[A-Za-z][A-Za-z0-9+#._-]{1,20}/g)) {
    tokens.push(m[0].toLowerCase());
  }
  for (const m of String(text || '').matchAll(/[一-鿿]{2,}/g)) {
    const run = m[0];
    for (let i = 0; i + 2 <= run.length; i += 1) tokens.push(run.slice(i, i + 2));
  }
  return tokens;
}

function docFreq(itemTokensList) {
  const df = new Map();
  for (const set of itemTokensList) {
    for (const t of set) df.set(t, (df.get(t) || 0) + 1);
  }
  return df;
}

function cleanTitle(t) {
  let s = String(t || '').trim();
  // 去掉尾部站点名（"xxx - GitHub"、"xxx | 掘金"、"xxx / X"）
  s = s.replace(/\s+[-|—–·:：/][^-|—–·:：/]{1,30}$/, '').trim();
  return s.slice(0, 20) || '分组';
}

function nameCluster(members, globalDf, totalItems, centralTitle) {
  // 1) 区分度主题词：簇内 df ≥2 且全局占比低；score = 簇内次数 / 全局次数
  //    只对「洗掉站点后缀的标题」分词，避免 Notion/GitHub 这类词冒充主题
  const domainCounts = new Map();
  for (const m of members) {
    const d = registrableDomain(m.url);
    if (d) domainCounts.set(d, (domainCounts.get(d) || 0) + 1);
  }
  let bestDomain = null;
  let bestDomainN = 0;
  for (const [d, n] of domainCounts) {
    if (n > bestDomainN) {
      bestDomain = d;
      bestDomainN = n;
    }
  }
  const local = new Map();
  for (const m of members) {
    const toks = new Set(tokenize(cleanTitle(m.title)));
    for (const t of toks) local.set(t, (local.get(t) || 0) + 1);
  }
  let best = null;
  let bestScore = 0;
  for (const [tok, ln] of local) {
    if (ln < 2 || CJK_STOP.has(tok)) continue;
    if (bestDomain && tok === bestDomain) continue;
    const gn = globalDf.get(tok) || 0;
    if (gn / totalItems > 0.6) continue; // 全局泛滥词没有区分度
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

  // 2) 簇中心成员的标题（去掉站点后缀），读起来像话题
  const central = cleanTitle(centralTitle || members[0]?.title);
  if (central && central !== '分组') return central;

  // 3) 最后才是域名（同一域名 ≥2/3）
  if (bestDomain && bestDomainN >= 2 && bestDomainN / members.length >= 0.67) {
    return bestDomain;
  }
  return central || '分组';
}

// ---------------------------------------------------------------------------
// 聚类：域名分桶 → 大桶内凝聚式（average linkage）→ 分位数自适应阈值
//
// 为什么不全局聚类：实测小模型在短标题上的相似度分布太扁/太噪，
// 全局单一阈值不是一刀切就是碎一地；而「同域内」主题可分性显著更好。
// 自适应阈值用桶内两两相似度的分位数，对 e5/bge 的压缩分布同样稳健。
// ---------------------------------------------------------------------------

const MIN_SPLIT = 4; // 域名桶 ≥4 个标签才做主题细分
const SIM_FLOOR = 0.3; // 绝对下限：低于此不合并
const SIM_Q = 0.7; // 桶内两两相似度分位数

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/** 预计算桶内 n×n 相似度矩阵（含模长归一化，与 cosine 等价）。O(n²·dim) 一次算清 */
function buildSimMatrix(vecs) {
  const n = vecs.length;
  const m = new Float32Array(n * n);
  const norms = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    let s = 0;
    for (let k = 0; k < vecs[i].length; k += 1) s += vecs[i][k] * vecs[i][k];
    norms[i] = Math.sqrt(s) || 1;
  }
  for (let i = 0; i < n; i += 1) {
    m[i * n + i] = 1;
    const vi = vecs[i];
    for (let j = i + 1; j < n; j += 1) {
      const vj = vecs[j];
      let dot = 0;
      for (let k = 0; k < vi.length; k += 1) dot += vi[k] * vj[k];
      const sim = dot / (norms[i] * norms[j]);
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
function agglomerative(items, vectors, simMatrix, threshold) {
  const n = items.length;
  const clusters = items.map((it, i) => ({ members: [it], vecs: [vectors[i]] }));
  // sum[c1*n+c2] = 簇 c1 与簇 c2 的成员相似度之和（初始为单例相似度）
  const sum = Float32Array.from(simMatrix);
  for (;;) {
    let best = threshold;
    let bi = -1;
    let bj = -1;
    for (let i = 0; i < n; i += 1) {
      if (!clusters[i]) continue;
      const si = clusters[i].members.length;
      for (let j = i + 1; j < n; j += 1) {
        if (!clusters[j]) continue;
        const avg = sum[i * n + j] / (si * clusters[j].members.length);
        if (avg > best) {
          best = avg;
          bi = i;
          bj = j;
        }
      }
    }
    if (bi < 0) break;
    for (let k = 0; k < n; k += 1) {
      if (k === bi || k === bj || !clusters[k]) continue;
      sum[bi * n + k] += sum[bj * n + k];
      sum[k * n + bi] = sum[bi * n + k];
    }
    clusters[bi].members.push(...clusters[bj].members);
    clusters[bi].vecs.push(...clusters[bj].vecs);
    clusters[bj] = null;
  }
  return clusters.filter(Boolean);
}

/** 簇中心成员（命名兜底用） */
function centralMember(cluster) {
  // 平均向量当质心
  const dim = cluster.vecs[0].length;
  const centroid = new Float32Array(dim);
  for (const v of cluster.vecs) for (let k = 0; k < dim; k += 1) centroid[k] += v[k] / cluster.vecs.length;
  let central = cluster.members[0];
  let bestSim = -1;
  for (let i = 0; i < cluster.members.length; i += 1) {
    const sim = cosine(cluster.vecs[i], centroid);
    if (sim > bestSim) {
      bestSim = sim;
      central = cluster.members[i];
    }
  }
  return central;
}

function pushGroup(groups, usedNames, name, members) {
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

export async function preloadBrowserModel(modelId, { preferWebGPU = true, onStatus } = {}) {
  await getExtractor(modelId, { onStatus, preferWebGPU });
  return true;
}

export async function classifyWithBrowserEmbed(items, { onStatus, modelId, preferWebGPU = true } = {}) {
  if (!items.length) return { groups: [], ungrouped: [] };
  const meta = getBrowserModelMeta(modelId || DEFAULT_BROWSER_MODEL);

  // 1) 域名分桶：小桶直接是站点组，不需要模型
  const byDomain = new Map();
  const noDomain = [];
  for (const t of items) {
    const d = registrableDomain(t.url) || '';
    if (!d) {
      noDomain.push(t);
      continue;
    }
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d).push(t);
  }
  const buckets = [...byDomain.entries()];
  const bigBuckets = buckets.filter(([, tabs]) => tabs.length >= MIN_SPLIT);

  // 2) 大桶才嵌入：一次批量编码，按桶切片
  const embedded = new Map(); // tab -> vector
  if (bigBuckets.length) {
    const flat = bigBuckets.flatMap(([, tabs]) => tabs);
    const extractor = await getExtractor(meta.id, { onStatus, preferWebGPU });
    onStatus?.(`编码 ${flat.length} 个标签（${meta.label} · ${lastDevice}）…`);
    const prefix = meta.textPrefix || '';
    const texts = flat.map((t) => embedText(t, prefix));
    const output = await extractor(texts, { pooling: 'mean', normalize: true });
    const list = output.tolist();
    for (let i = 0; i < flat.length; i += 1) embedded.set(flat[i], Float32Array.from(list[i]));
    onStatus?.('按主题聚类…');
  }

  // 全局词频（主题命名做区分度参照；用洗掉站点后缀的标题）
  const globalDf = docFreq(items.map((t) => new Set(tokenize(cleanTitle(t.title)))));

  const groups = [];
  const ungrouped = [...noDomain];
  const usedNames = new Set();
  for (const [domain, tabs] of buckets) {
    if (tabs.length < MIN_SPLIT) {
      // 小桶：站点组
      if (tabs.length >= 2) pushGroup(groups, usedNames, domain, tabs);
      else ungrouped.push(...tabs);
      continue;
    }
    const vecs = tabs.map((t) => embedded.get(t));
    const simMatrix = buildSimMatrix(vecs);
    const sims = [];
    for (let i = 0; i < vecs.length; i += 1) {
      for (let j = i + 1; j < vecs.length; j += 1) sims.push(simMatrix[i * vecs.length + j]);
    }
    sims.sort((a, b) => a - b);
    const threshold = Math.max(SIM_FLOOR, quantile(sims, SIM_Q));
    const clusters = agglomerative(tabs, vecs, simMatrix, threshold);
    // ≥2 的子簇成主题组；落单的合成「站点 · 其他」组
    const singles = [];
    for (const c of clusters) {
      if (c.members.length >= 2) {
        const name = nameCluster(c.members, globalDf, items.length, centralMember(c)?.title);
        pushGroup(groups, usedNames, name, c.members);
      } else {
        singles.push(...c.members);
      }
    }
    if (singles.length >= 2) pushGroup(groups, usedNames, domain, singles);
    else ungrouped.push(...singles);
  }
  groups.sort((a, b) => b.tabs.length - a.tabs.length || a.name.localeCompare(b.name, 'zh'));
  return { groups, ungrouped };
}

// 仅供单测/调试
export const __test__ = { agglomerative, buildSimMatrix, quantile, nameCluster, tokenize, cleanTitle, embedText, cosine, centralMember };
