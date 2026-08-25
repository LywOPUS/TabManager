/** Hugging Face 及国内镜像；大文件常跳到 *.hf.co / xet */
export const MODEL_HOSTS = [
  'https://huggingface.co',
  'https://hf-mirror.com',
];

export const MODEL_HOST_PERMISSIONS = [
  'https://huggingface.co/*',
  'https://*.huggingface.co/*',
  'https://hf-mirror.com/*',
  'https://*.hf.co/*',
  'https://*.xethub.hf.co/*',
];

export async function ensureModelHostPermission() {
  if (typeof chrome === 'undefined' || !chrome.permissions?.request) return true;
  try {
    if (await chrome.permissions.contains({ origins: MODEL_HOST_PERMISSIONS })) return true;
    return await chrome.permissions.request({ origins: MODEL_HOST_PERMISSIONS });
  } catch {
    return false;
  }
}

export async function pickModelRemoteHost() {
  let lastErr = '';
  for (const host of MODEL_HOSTS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(`${host}/onnx-community/embeddinggemma-300m-ONNX/resolve/main/config.json`, {
        method: 'GET',
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.ok) return host;
      lastErr = `${host} ${res.status}`;
    } catch (e) {
      lastErr = `${host} ${e instanceof Error ? e.name : String(e)}`
    }
  }
  throw new Error(`连不上模型源（${lastErr || '网络失败'}）。可改用内置 MiniLM，或开代理后再下。`);
}
