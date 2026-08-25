/** 模型推理放到 offscreen。Service Worker 不能动态 import()，必须走这里。 */

import { isRecord } from './unknown.js'

export type OffscreenRpcOp = 'classify' | 'preload' | 'unload' | 'warm' | 'device'

export type OffscreenRpcBody = {
  items?: unknown
  opts?: unknown
  modelId?: unknown
  preferWebGPU?: unknown
}

type ModelRpcEnvelope = {
  type: 'tm-offscreen' | 'tm-model'
  op: OffscreenRpcOp
  reqId: string
  items?: unknown
  opts?: unknown
  modelId?: unknown
  preferWebGPU?: unknown
}

export function inOffscreenPage() {
  try {
    return typeof location !== 'undefined' && /offscreen\.html$/i.test(location.pathname);
  } catch {
    return false;
  }
}

export function inPopupPage() {
  try {
    return typeof location !== 'undefined' && /popup\.html$/i.test(location.pathname);
  } catch {
    return false;
  }
}

export function inServiceWorker() {
  return typeof document === 'undefined';
}

export async function ensureOffscreen() {
  if (inOffscreenPage()) return true;
  if (typeof chrome === 'undefined' || !chrome.offscreen?.createDocument) return false;
  try {
    const ctxs = await chrome.runtime.getContexts?.({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (ctxs?.length) return true;
  } catch {
    /* 旧内核没有 getContexts */
  }
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS'],
      justification: '加载浏览器内分类模型并推理',
    });
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (/already exists|only one/i.test(message)) return true
    console.warn('offscreen create failed', e);
    return false;
  }
}

export function canUseOffscreen() {
  if (inOffscreenPage()) return false;
  return typeof chrome !== 'undefined' && !!chrome.offscreen?.createDocument;
}

/**
 * SW 一律进 offscreen（规范禁止 import()）。
 * 页面里：内置 MiniLM 就地加载，需下载的大模型才进 offscreen。
 */
export function shouldOffloadModel(meta?: { bundled?: boolean }) {
  if (!canUseOffscreen()) return false;
  if (inServiceWorker()) return true;
  return !!(meta && !meta.bundled);
}

export async function offscreenRpc(
  op: OffscreenRpcOp,
  payload: OffscreenRpcBody = {},
  onStatus?: (text: string, detail?: unknown) => void,
): Promise<unknown> {
  const ok = await ensureOffscreen();
  if (!ok) throw new Error('无法启动模型运行页');
  const reqId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const onMsg = (msg: unknown) => {
    if (!isRecord(msg) || msg.type !== 'tm-model-status' || msg.reqId !== reqId) return
    const text = typeof msg.text === 'string' ? msg.text : ''
    onStatus?.(text, msg.detail)
  }
  chrome.runtime.onMessage.addListener(onMsg);
  const envelope: ModelRpcEnvelope = {
    type: inServiceWorker() ? 'tm-offscreen' : 'tm-model',
    op,
    reqId,
    items: payload.items,
    opts: payload.opts,
    modelId: payload.modelId,
    preferWebGPU: payload.preferWebGPU,
  }
  try {
    const res = await sendWithRetry(envelope);
    if (isRecord(res) && typeof res.error === 'string') throw new Error(res.error);
    return res;
  } finally {
    chrome.runtime.onMessage.removeListener(onMsg);
  }
}

async function sendWithRetry(envelope: ModelRpcEnvelope, tries = 8): Promise<unknown> {
  let last = new Error('模型运行页未就绪');
  for (let i = 0; i < tries; i += 1) {
    try {
      const res: unknown = await chrome.runtime.sendMessage(envelope);
      if (chrome.runtime.lastError) throw new Error(chrome.runtime.lastError.message);
      if (res !== undefined) return res;
    } catch (e) {
      last = e instanceof Error ? e : new Error(String(e));
    }
    await new Promise((r) => setTimeout(r, 80 * (i + 1)));
  }
  throw last;
}
