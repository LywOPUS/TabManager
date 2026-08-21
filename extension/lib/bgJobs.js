/**
 * 整理活只在 background 跑。弹窗发 ORGANIZE，听 tm-job-status。
 */
import {
  mergeAndOrganizeCurrent,
  moveRelatedToNewWindow,
  organizeAroundCurrentPage,
  organizeByTopic,
  organizeCurrentWindow,
  organizeSelectedTabs,
  relatedToNewWindowSummary,
} from './liveOrganize.js';

let running = null;

export function organizeJobBusy() {
  return !!running;
}

function slimResult(r) {
  if (!r || typeof r !== 'object') return { ok: false, reason: 'apply_failed' };
  return {
    ok: !!r.ok,
    reason: r.reason,
    error: r.error,
    source: r.source,
    count: r.count,
    name: r.name,
    moved: r.moved,
    topic: r.topic,
    apply: r.apply && {
      created: r.apply.created,
      absorbTabs: r.apply.absorbTabs,
      merged: r.apply.merged,
    },
    summary: r.summary && { movableTabs: r.summary.movableTabs },
  };
}

export async function runOrganizeJob(op, payload = {}, onStatus) {
  if (running) return { ok: false, reason: 'busy', error: '正在整理，请稍候' };
  const task = (async () => {
    switch (op) {
      case 'window':
        return organizeCurrentWindow(onStatus);
      case 'selected':
        return organizeSelectedTabs(onStatus);
      case 'around':
        return organizeAroundCurrentPage(onStatus);
      case 'topic':
        return organizeByTopic(String(payload.query || ''), onStatus);
      case 'related-summary': {
        const s = await relatedToNewWindowSummary(onStatus);
        if (!s) return { ok: false, reason: 'no_window', count: 0 };
        return { ...s, ok: !s.reason && (s.count || 0) >= 2 };
      }
      case 'related':
        return moveRelatedToNewWindow(onStatus);
      case 'merge':
        return mergeAndOrganizeCurrent({ onProgress: onStatus });
      default:
        return { ok: false, reason: 'stale_sw', error: `不支持的整理操作：${op || '空'}` };
    }
  })();
  running = task;
  try {
    return slimResult(await task);
  } finally {
    if (running === task) running = null;
  }
}

export function organizeStatusText(text) {
  const t = String(text || '');
  if (!t) return '';
  if (/文件已齐|下载中|^从 .+ 拉取|正在下载/.test(t)) return '正在加载模型';
  return t;
}

export function jobStatusFn(reqId) {
  if (!reqId) return undefined;
  return (text) => {
    const out = organizeStatusText(text);
    if (!out) return;
    chrome.runtime.sendMessage({
      type: 'tm-job-status',
      reqId,
      text: out,
    }).catch(() => {});
  };
}
