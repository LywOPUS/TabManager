/** 浏览器内可用的 Xenova INT8/量化句向量模型（transformers.js） */
export const BROWSER_MODELS = [
  {
    id: 'Xenova/all-MiniLM-L6-v2',
    label: '内置 · MiniLM-L6',
    note: '约 23MB，随扩展内置、开箱即用；英文可以，中文建议用多语言模型',
    bundled: true,
  },
  {
    id: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    label: '多语言 MiniLM（需下载 ~118MB）',
    note: '中英都行，中文推荐；首次下载较大，缓存后秒开',
  },
  {
    id: 'Xenova/multilingual-e5-small',
    label: 'E5-small（需下载 ~118MB）',
    note: '多语言检索向；首次下载较大',
    /** e5 习惯加 query: 前缀；分组用 passage: */
    textPrefix: 'passage: ',
  },
];

export const DEFAULT_BROWSER_MODEL = BROWSER_MODELS[0].id;

export function getBrowserModelMeta(id) {
  return BROWSER_MODELS.find((m) => m.id === id) || BROWSER_MODELS[0];
}
