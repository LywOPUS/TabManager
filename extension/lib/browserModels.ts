export type ClusterParams = {
  floor: number
  q: number
  cap: number
  prefixMinBody: number
}

export type BrowserModelMeta = {
  id: string
  label: string
  note: string
  bundled?: boolean
  textPrefix?: string
  cluster: ClusterParams
}

/** MiniLM 句对相似度带：短英文标题常用 */
export const MINILM_CLUSTER: ClusterParams = { floor: 0.38, q: 0.55, cap: 0.62, prefixMinBody: 0 }
/** Gemma 余弦整体偏高，门槛抬高；短标题不加指令前缀，避免被 prefix 拉近 */
export const GEMMA_CLUSTER: ClusterParams = { floor: 0.52, q: 0.58, cap: 0.74, prefixMinBody: 24 }

/** 浏览器内可用的句向量模型（transformers.js / ONNX） */
export const BROWSER_MODELS: [BrowserModelMeta, ...BrowserModelMeta[]] = [
  {
    id: 'Xenova/all-MiniLM-L6-v2',
    label: '内置 · MiniLM-L6',
    note: '约 23MB，随扩展内置、开箱即用。权重在扩展包，不走模型库下载',
    bundled: true,
    cluster: MINILM_CLUSTER,
  },
  {
    id: 'onnx-community/embeddinggemma-300m-ONNX',
    label: 'EmbeddingGemma（需下载 ~330MB）',
    note: 'Google 端侧多语言模型；中文更好，英文短标题未必强过 MiniLM。只在管理页「模型」下载',
    textPrefix: 'task: clustering | query: ',
    cluster: GEMMA_CLUSTER,
  },
  {
    id: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    label: '多语言 MiniLM（需下载 ~118MB）',
    note: '中英都行；比 EmbeddingGemma 轻，主题区分弱一些',
    cluster: MINILM_CLUSTER,
  },
  {
    id: 'Xenova/multilingual-e5-small',
    label: 'E5-small（需下载 ~118MB）',
    note: '多语言检索向；首次下载较大',
    textPrefix: 'passage: ',
    cluster: { floor: 0.42, q: 0.55, cap: 0.68, prefixMinBody: 0 },
  },
];

export const DEFAULT_BROWSER_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const GEMMA_BROWSER_MODEL = 'onnx-community/embeddinggemma-300m-ONNX';
export const LEGACY_BROWSER_MODEL = DEFAULT_BROWSER_MODEL;

export function getBrowserModelMeta(id: string): BrowserModelMeta {
  return BROWSER_MODELS.find((m) => m.id === id) ?? BROWSER_MODELS[0]
}

export function getClusterParams(idOrMeta: string | BrowserModelMeta): ClusterParams {
  const meta = typeof idOrMeta === 'string' ? getBrowserModelMeta(idOrMeta) : idOrMeta
  const c = meta.cluster
  return {
    floor: c.floor ?? MINILM_CLUSTER.floor,
    q: c.q ?? MINILM_CLUSTER.q,
    cap: c.cap ?? MINILM_CLUSTER.cap,
    prefixMinBody: c.prefixMinBody ?? 0,
  }
}
