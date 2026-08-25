import { isReservedGroupName, type Session, type StashedTab } from './chrome-ext'

export type TabHit = {
  sessionId: string
  sessionName: string
  groupId: string
  groupName: string
  tab: StashedTab
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function includesNeedle(text: string, needle: string) {
  return text.toLowerCase().includes(needle)
}

/** 标题 / 网址 / 域名命中优先；会话名或主题组名命中且无标签命中时退回整会话 */
export function collectSearchHits(sessions: Session[], query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return { tabHits: [] as TabHit[], sessionOnly: [] as Session[] }

  const tabHits: TabHit[] = []
  const sessionOnly: Session[] = []

  for (const session of sessions) {
    const sessionNameHit = includesNeedle(session.name, needle)
    let tabHitInSession = false
    for (const group of session.groups) {
      for (const tab of group.tabs) {
        const title = tab.title || ''
        const url = tab.url || ''
        const host = hostOf(url)
        if (includesNeedle(title, needle) || includesNeedle(url, needle) || includesNeedle(host, needle)) {
          tabHits.push({
            sessionId: session.id,
            sessionName: session.name,
            groupId: group.id,
            groupName: group.name,
            tab,
          })
          tabHitInSession = true
        }
      }
    }
    if (tabHitInSession) continue
    const groupHit = session.groups.some(
      (g) => !isReservedGroupName(g.name) && includesNeedle(g.name, needle),
    )
    if (sessionNameHit || groupHit) sessionOnly.push(session)
  }

  return { tabHits, sessionOnly }
}

export function highlightMatch(text: string, query: string): { before: string; match: string; after: string } | null {
  const needle = query.trim()
  if (!needle || !text) return null
  const i = text.toLowerCase().indexOf(needle.toLowerCase())
  if (i < 0) return null
  return {
    before: text.slice(0, i),
    match: text.slice(i, i + needle.length),
    after: text.slice(i + needle.length),
  }
}
