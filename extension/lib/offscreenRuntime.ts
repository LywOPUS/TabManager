/** 模型推理放到 offscreen。Service Worker 不能动态 import()，必须走这里。 */

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
    if (/already exists|only one/i.test(String(e?.message || e))) return true;
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
export function shouldOffloadModel(meta) {
  if (!canUseOffscreen()) return false;
  if (inServiceWorker()) return true;
  return !!(meta && !meta.bundled);
}

export async function offscreenRpc(op, payload = {}, onStatus) {
  const ok = await ensureOffscreen();
  if (!ok) throw new Error('无法启动模型运行页');
  const reqId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const onMsg = (msg) => {
    if (msg?.type === 'tm-model-status' && msg.reqId === reqId) {
      onStatus?.(msg.text, msg.detail);
    }
  };
  chrome.runtime.onMessage.addListener(onMsg);
  const body = { ...payload, op, reqId };
  try {
    const envelope = inServiceWorker()
      ? { type: 'tm-offscreen', ...body }
      : { type: 'tm-model', ...body };
    const res = await sendWithRetry(envelope);
    if (res?.error) throw new Error(res.error);
    return res;
  } finally {
    chrome.runtime.onMessage.removeListener(onMsg);
  }
}

async function sendWithRetry(envelope, tries = 8) {
  let last = new Error('模型运行页未就绪');
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await chrome.runtime.sendMessage(envelope);
      if (chrome.runtime.lastError) throw new Error(chrome.runtime.lastError.message);
      if (res !== undefined) return res;
    } catch (e) {
      last = e instanceof Error ? e : new Error(String(e));
    }
    await new Promise((r) => setTimeout(r, 80 * (i + 1)));
  }
  throw last;
}
