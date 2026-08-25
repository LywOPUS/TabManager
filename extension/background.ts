import { stashCurrentWindow, stashAllWindows, type StashResult } from './lib/stash.js'
import { jobStatusFn, runOrganizeJob, type OrganizeJobResult } from './lib/bgJobs.js'
import { getSettings } from './lib/settings.js'
import { ensureOffscreen } from './lib/offscreenRuntime.js'
import { isRecord } from './lib/unknown.js'

const MENU = {
  STASH_WINDOW: 'stash-window',
  STASH_ALL: 'stash-all',
  ORGANIZE_WINDOW: 'organize-window',
  ORGANIZE_SELECTED: 'organize-selected',
  ORGANIZE_AROUND: 'organize-around',
  RELATED_NEW_WINDOW: 'related-new-window',
  MERGE_ORGANIZE: 'merge-organize',
}

const COMMAND = {
  STASH: 'stash-other-tabs',
  MANAGE: 'open-management',
}

type BadgeFlash = { ok: true; count: number } | { ok: false }

type BgIncoming =
  | { kind: 'ignore' }
  | { kind: 'forward' }
  | { kind: 'stash-window'; keepActive: boolean; reviewInTab: boolean }
  | { kind: 'stash-all'; keepActive: boolean }
  | { kind: 'open-management'; hash: string }
  | { kind: 'model'; op: unknown; reqId: unknown; items: unknown; opts: unknown; modelId: unknown; preferWebGPU: unknown }
  | { kind: 'organize'; job: string; query?: string; reqId?: string }

function managementUrl(hash = '') {
  return chrome.runtime.getURL(`management.html${hash}`)
}

async function openManagement(hash = '') {
  await chrome.tabs.create({ url: managementUrl(hash) })
}

let badgeTimer = 0
function badgeCount(r: StashResult | BadgeFlash) {
  return r.ok ? r.count : 0
}

async function flashStashBadge(r: StashResult | BadgeFlash) {
  const ok = r.ok
  const text = ok ? String(badgeCount(r)).slice(0, 4) : '!'
  try {
    await chrome.action.setBadgeBackgroundColor({ color: ok ? '#1d1d1f' : '#c2332b' })
    if (chrome.action.setBadgeTextColor) {
      await chrome.action.setBadgeTextColor({ color: '#ffffff' })
    }
    await chrome.action.setBadgeText({ text })
  } catch {
    /* 部分环境无 badge API */
  }
  clearTimeout(badgeTimer)
  badgeTimer = setTimeout(() => {
    chrome.action.setBadgeText({ text: '' }).catch(() => {})
  }, 2200)
}

function badgeFromJob(r: OrganizeJobResult, count: number): BadgeFlash {
  return r.ok ? { ok: true, count } : { ok: false }
}

function addMenu(id: string, title: string) {
  chrome.contextMenus.create({
    id,
    title,
    contexts: ['page', 'action'],
  })
}

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    addMenu(MENU.STASH_WINDOW, '收纳当前窗口（保留当前页）')
    addMenu(MENU.STASH_ALL, '收纳全部窗口（保留当前页）')
    addMenu(MENU.ORGANIZE_WINDOW, '整理当前窗口')
    addMenu(MENU.ORGANIZE_SELECTED, '整理选中的标签')
    addMenu(MENU.ORGANIZE_AROUND, '按当前页归组')
    addMenu(MENU.RELATED_NEW_WINDOW, '相关标签到新窗口')
    addMenu(MENU.MERGE_ORGANIZE, '整理全部窗口并合并到当前')
  })
}

setupContextMenus()

chrome.runtime.onInstalled.addListener(() => {
  setupContextMenus()
})

chrome.contextMenus.onClicked.addListener(async (info) => {
  try {
    if (info.menuItemId === MENU.STASH_WINDOW) {
      await flashStashBadge(await stashCurrentWindow({ keepActive: true }))
    } else if (info.menuItemId === MENU.STASH_ALL) {
      await flashStashBadge(await stashAllWindows({ keepActive: true }))
    } else if (info.menuItemId === MENU.ORGANIZE_WINDOW) {
      const r = await runOrganizeJob('window')
      await flashStashBadge(badgeFromJob(r, r.ok ? (r.apply?.created ?? 0) : 0))
    } else if (info.menuItemId === MENU.ORGANIZE_SELECTED) {
      const r = await runOrganizeJob('selected')
      await flashStashBadge(badgeFromJob(r, r.ok ? (r.apply?.created ?? 0) : 0))
    } else if (info.menuItemId === MENU.ORGANIZE_AROUND) {
      const r = await runOrganizeJob('around')
      await flashStashBadge(badgeFromJob(r, r.ok ? (r.apply?.created ?? 0) + (r.apply?.absorbTabs ?? 0) : 0))
    } else if (info.menuItemId === MENU.RELATED_NEW_WINDOW) {
      const r = await runOrganizeJob('related')
      await flashStashBadge(badgeFromJob(r, r.ok ? (r.moved ?? 0) : 0))
    } else if (info.menuItemId === MENU.MERGE_ORGANIZE) {
      await openManagement('#merge')
    }
  } catch (e) {
    console.error(e)
  }
})

chrome.commands.onCommand.addListener(async (command) => {
  try {
    if (command === COMMAND.STASH) {
      const r = await stashCurrentWindow({ keepActive: true })
      await flashStashBadge(r)
      if (r.ok) {
        const s = await getSettings()
        if (s.stashReview !== false) {
          await openManagement(`#review=${encodeURIComponent(r.session.id)}`)
        }
      }
      return
    }
    if (command === COMMAND.MANAGE) {
      await openManagement()
    }
  } catch (e) {
    console.error(e)
  }
})

function organizeJobOf(msg: Record<string, unknown>) {
  if (typeof msg.job === 'string') return msg.job
  if (typeof msg.op === 'string') return msg.op
  if (typeof msg.type !== 'string') return undefined
  if (msg.type === 'tm-organize' || msg.type === 'ORGANIZE' || msg.type === 'ORGANIZE_CURRENT_WINDOW') return 'window'
  if (msg.type === 'ORGANIZE_AROUND_CURRENT') return 'around'
  if (msg.type === 'MOVE_RELATED_NEW_WINDOW') return 'related'
  if (msg.type === 'MERGE_ORGANIZE') return 'merge'
  return undefined
}

function parseBgIncoming(msg: unknown): BgIncoming {
  if (!isRecord(msg)) return { kind: 'ignore' }
  const type = msg.type
  if (type === 'tm-offscreen' || type === 'tm-model-status' || type === 'tm-job-status') {
    return { kind: 'forward' }
  }
  if (type === 'STASH_CURRENT_WINDOW') {
    return {
      kind: 'stash-window',
      keepActive: msg.keepActive !== false,
      reviewInTab: !!msg.reviewInTab,
    }
  }
  if (type === 'STASH_ALL_WINDOWS') {
    return { kind: 'stash-all', keepActive: msg.keepActive !== false }
  }
  if (type === 'OPEN_MANAGEMENT') {
    return { kind: 'open-management', hash: typeof msg.hash === 'string' ? msg.hash : '' }
  }
  if (type === 'tm-model') {
    return {
      kind: 'model',
      op: msg.op,
      reqId: msg.reqId,
      items: msg.items,
      opts: msg.opts,
      modelId: msg.modelId,
      preferWebGPU: msg.preferWebGPU,
    }
  }
  const job = organizeJobOf(msg)
  const isOrganize = type === 'tm-organize' || type === 'ORGANIZE' || !!job && (
    type === 'ORGANIZE_CURRENT_WINDOW'
    || type === 'ORGANIZE_AROUND_CURRENT'
    || type === 'MOVE_RELATED_NEW_WINDOW'
    || type === 'MERGE_ORGANIZE'
  )
  if (!isOrganize) return { kind: 'ignore' }
  return {
    kind: 'organize',
    job: job ?? '',
    query: typeof msg.query === 'string' ? msg.query : undefined,
    reqId: typeof msg.reqId === 'string' ? msg.reqId : undefined,
  }
}

chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  const incoming = parseBgIncoming(msg)
  if (incoming.kind === 'ignore' || incoming.kind === 'forward') return false
  void (async () => {
    try {
      switch (incoming.kind) {
        case 'stash-window': {
          const r = await stashCurrentWindow({ keepActive: incoming.keepActive })
          if (r.ok && incoming.reviewInTab) {
            await openManagement(`#review=${encodeURIComponent(r.session.id)}`)
          }
          sendResponse(r)
          return
        }
        case 'stash-all':
          sendResponse(await stashAllWindows({ keepActive: incoming.keepActive }))
          return
        case 'open-management':
          await openManagement(incoming.hash)
          sendResponse({ ok: true })
          return
        case 'model': {
          await ensureOffscreen()
          let last = new Error('模型运行页未就绪')
          let res: unknown
          for (let i = 0; i < 8; i += 1) {
            try {
              res = await chrome.runtime.sendMessage({
                type: 'tm-offscreen',
                op: incoming.op,
                reqId: incoming.reqId,
                items: incoming.items,
                opts: incoming.opts,
                modelId: incoming.modelId,
                preferWebGPU: incoming.preferWebGPU,
              })
              if (res !== undefined) break
            } catch (e) {
              last = e instanceof Error ? e : new Error(String(e))
              await new Promise((r) => setTimeout(r, 80 * (i + 1)))
            }
          }
          sendResponse(res ?? { error: last.message })
          return
        }
        case 'organize':
          sendResponse(
            await runOrganizeJob(
              incoming.job,
              { query: incoming.query },
              jobStatusFn(incoming.reqId),
            ),
          )
          return
        default: {
          const _exhaustive: never = incoming
          void _exhaustive
        }
      }
    } catch (e) {
      sendResponse({
        ok: false,
        reason: 'classify_failed',
        error: e instanceof Error ? e.message : String(e),
      })
    }
  })()
  return true
})
