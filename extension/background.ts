import { stashCurrentWindow, stashAllWindows } from './lib/stash.js';
import { jobStatusFn, runOrganizeJob } from './lib/bgJobs.js';
import { getSettings } from './lib/settings.js';
import { ensureOffscreen } from './lib/offscreenRuntime.js';

const MENU = {
  STASH_WINDOW: 'stash-window',
  STASH_ALL: 'stash-all',
  ORGANIZE_WINDOW: 'organize-window',
  ORGANIZE_SELECTED: 'organize-selected',
  ORGANIZE_AROUND: 'organize-around',
  RELATED_NEW_WINDOW: 'related-new-window',
  MERGE_ORGANIZE: 'merge-organize',
};

const CTX = ['page', 'action'];
const COMMAND = {
  STASH: 'stash-other-tabs',
  MANAGE: 'open-management',
};

function managementUrl(hash = '') {
  return chrome.runtime.getURL(`management.html${hash}`);
}

async function openManagement(hash = '') {
  await chrome.tabs.create({ url: managementUrl(hash) });
}

let badgeTimer = 0;
async function flashStashBadge(r) {
  const ok = !!r?.ok;
  const text = ok ? String(r.count ?? 0).slice(0, 4) : '!';
  try {
    await chrome.action.setBadgeBackgroundColor({ color: ok ? '#1d1d1f' : '#c2332b' });
    if (chrome.action.setBadgeTextColor) {
      await chrome.action.setBadgeTextColor({ color: '#ffffff' });
    }
    await chrome.action.setBadgeText({ text });
  } catch {
    /* 部分环境无 badge API */
  }
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => {
    chrome.action.setBadgeText({ text: '' }).catch(() => {});
  }, 2200);
}

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU.STASH_WINDOW,
      title: '收纳当前窗口（保留当前页）',
      contexts: CTX,
    });
    chrome.contextMenus.create({
      id: MENU.STASH_ALL,
      title: '收纳全部窗口（保留当前页）',
      contexts: CTX,
    });
    chrome.contextMenus.create({
      id: MENU.ORGANIZE_WINDOW,
      title: '整理当前窗口',
      contexts: CTX,
    });
    chrome.contextMenus.create({
      id: MENU.ORGANIZE_SELECTED,
      title: '整理选中的标签',
      contexts: CTX,
    });
    chrome.contextMenus.create({
      id: MENU.ORGANIZE_AROUND,
      title: '按当前页归组',
      contexts: CTX,
    });
    chrome.contextMenus.create({
      id: MENU.RELATED_NEW_WINDOW,
      title: '相关标签到新窗口',
      contexts: CTX,
    });
    chrome.contextMenus.create({
      id: MENU.MERGE_ORGANIZE,
      title: '整理全部窗口并合并到当前',
      contexts: CTX,
    });
  });
}

setupContextMenus();

chrome.runtime.onInstalled.addListener(() => {
  setupContextMenus();
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  try {
    if (info.menuItemId === MENU.STASH_WINDOW) {
      await flashStashBadge(await stashCurrentWindow({ keepActive: true }));
    } else if (info.menuItemId === MENU.STASH_ALL) {
      await flashStashBadge(await stashAllWindows({ keepActive: true }));
    } else if (info.menuItemId === MENU.ORGANIZE_WINDOW) {
      const r = await runOrganizeJob('window');
      await flashStashBadge({ ok: !!r?.ok, count: r?.apply?.created ?? 0 });
    } else if (info.menuItemId === MENU.ORGANIZE_SELECTED) {
      const r = await runOrganizeJob('selected');
      await flashStashBadge({ ok: !!r?.ok, count: r?.apply?.created ?? 0 });
    } else if (info.menuItemId === MENU.ORGANIZE_AROUND) {
      const r = await runOrganizeJob('around');
      await flashStashBadge({ ok: !!r?.ok, count: (r?.apply?.created ?? 0) + (r?.apply?.absorbTabs ?? 0) });
    } else if (info.menuItemId === MENU.RELATED_NEW_WINDOW) {
      const r = await runOrganizeJob('related');
      await flashStashBadge({ ok: !!r?.ok, count: r?.moved ?? 0 });
    } else if (info.menuItemId === MENU.MERGE_ORGANIZE) {
      await openManagement('#merge');
    }
  } catch (e) {
    console.error(e);
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  try {
    if (command === COMMAND.STASH) {
      const r = await stashCurrentWindow({ keepActive: true });
      await flashStashBadge(r);
      if (r.ok) {
        const s = await getSettings();
        if (s.stashReview !== false) {
          await openManagement(`#review=${encodeURIComponent(r.session.id)}`);
        }
      }
      return;
    }
    if (command === COMMAND.MANAGE) {
      await openManagement();
    }
  } catch (e) {
    console.error(e);
  }
});

function organizeJobOf(msg) {
  if (msg?.job || msg?.op) return msg.job || msg.op;
  return {
    'tm-organize': 'window',
    ORGANIZE: 'window',
    ORGANIZE_CURRENT_WINDOW: 'window',
    ORGANIZE_AROUND_CURRENT: 'around',
    MOVE_RELATED_NEW_WINDOW: 'related',
    MERGE_ORGANIZE: 'merge',
  }[msg?.type];
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const type = msg?.type;
  // 转给 offscreen / 弹窗的消息，以及不认识的消息，都不能回包。
  if (
    type === 'tm-offscreen'
    || type === 'tm-model-status'
    || type === 'tm-job-status'
  ) {
    return false;
  }
  const job = organizeJobOf(msg);
  const isOrganize = type === 'tm-organize' || type === 'ORGANIZE' || !!job && (
    type === 'ORGANIZE_CURRENT_WINDOW'
    || type === 'ORGANIZE_AROUND_CURRENT'
    || type === 'MOVE_RELATED_NEW_WINDOW'
    || type === 'MERGE_ORGANIZE'
  );
  if (!isOrganize && type !== 'STASH_CURRENT_WINDOW' && type !== 'STASH_ALL_WINDOWS' && type !== 'OPEN_MANAGEMENT' && type !== 'tm-model') {
    return false;
  }
  (async () => {
    try {
      if (type === 'STASH_CURRENT_WINDOW') {
        const keepActive = msg.keepActive !== false;
        const r = await stashCurrentWindow({ keepActive });
        if (r.ok && msg.reviewInTab) {
          await openManagement(`#review=${encodeURIComponent(r.session.id)}`);
        }
        sendResponse(r);
        return;
      }
      if (type === 'STASH_ALL_WINDOWS') {
        sendResponse(await stashAllWindows({ keepActive: msg.keepActive !== false }));
        return;
      }
      if (type === 'OPEN_MANAGEMENT') {
        await openManagement(typeof msg.hash === 'string' ? msg.hash : '');
        sendResponse({ ok: true });
        return;
      }
      if (type === 'tm-model') {
        await ensureOffscreen();
        let last = new Error('模型运行页未就绪');
        let res;
        for (let i = 0; i < 8; i += 1) {
          try {
            res = await chrome.runtime.sendMessage({
              type: 'tm-offscreen',
              op: msg.op,
              reqId: msg.reqId,
              items: msg.items,
              opts: msg.opts,
              modelId: msg.modelId,
              preferWebGPU: msg.preferWebGPU,
            });
            if (res !== undefined) break;
          } catch (e) {
            last = e instanceof Error ? e : new Error(String(e));
            await new Promise((r) => setTimeout(r, 80 * (i + 1)));
          }
        }
        sendResponse(res ?? { error: last.message });
        return;
      }
      sendResponse(await runOrganizeJob(job, { query: msg.query }, jobStatusFn(msg.reqId)));
    } catch (e) {
      sendResponse({ ok: false, reason: 'classify_failed', error: String(e?.message || e) });
    }
  })();
  return true;
});
