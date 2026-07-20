// ponytail: 简化 PSL — 常见多段后缀 + hostname 回退；完整 PSL（如 tldts）后续替换
const MULTI_SUFFIX = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn',
  'com.au', 'net.au', 'org.au',
  'co.jp', 'ne.jp', 'or.jp',
  'com.br', 'com.mx', 'com.tw', 'com.hk',
  'github.io', 'gitlab.io', 'herokuapp.com', 'vercel.app', 'netlify.app',
]);

export function registrableDomain(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    let h = u.hostname.replace(/\.$/, '').toLowerCase();
    if (!h) return null;
    if (h.startsWith('www.')) h = h.slice(4);
    const parts = h.split('.');
    if (parts.length <= 1) return h;
    const last2 = parts.slice(-2).join('.');
    if (MULTI_SUFFIX.has(last2) && parts.length >= 3) {
      return parts.slice(-3).join('.');
    }
    for (const suf of MULTI_SUFFIX) {
      if (h === suf || h.endsWith('.' + suf)) {
        const need = suf.split('.').length + 1;
        if (parts.length >= need) return parts.slice(-need).join('.');
      }
    }
    return parts.length >= 2 ? parts.slice(-2).join('.') : h;
  } catch {
    return null;
  }
}

/** @param {{id:string,title:string,url:string}[]} items */
export function suggestGroups(items) {
  const buckets = new Map();
  const ungrouped = [];
  for (const item of items) {
    const key = registrableDomain(item.url);
    if (!key) {
      ungrouped.push(item);
      continue;
    }
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  }
  const groups = [];
  for (const [key, tabs] of buckets) {
    if (tabs.length >= 2) {
      groups.push({ key, name: key, tabIds: tabs.map((t) => t.id), tabs });
    } else {
      ungrouped.push(...tabs);
    }
  }
  groups.sort((a, b) => a.name.localeCompare(b.name));
  return { groups, ungrouped };
}
