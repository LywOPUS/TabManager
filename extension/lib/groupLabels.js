/**
 * 站点显示名与分组收尾。改 Edge 式组名、合并同站、挡住套话残词、跨站主题剥离时只改这一份。
 *
 * 加站：
 * 1) SITE_LABELS 写显示名
 * 2) 多个域名指向同一站时写 SITE_ALIASES（twitter.com → x.com）
 * 3) 标题是「在 X 上的帖子」这类套话 → TEMPLATE_SITES：不要用套话残词当组名；
 *    忙的时候按作者/handle 拆；剥掉套话后的正文才参与跨站主题。
 */
import { registrableDomain } from './groupHeuristics.js';

export const SITE_ALIASES = {
  'twitter.com': 'x.com',
  'youtu.be': 'youtube.com',
  'b23.tv': 'bilibili.com',
};

/** 完整主机名 → 站点（在 eTLD+1 之前） */
export const HOST_ALIASES = {
  'chat.openai.com': 'chatgpt.com',
};

export const SITE_LABELS = {
  'x.com': 'X',
  'youtube.com': 'YouTube',
  'github.com': 'GitHub',
  'gitlab.com': 'GitLab',
  'google.com': 'Google',
  'notion.so': 'Notion',
  'reddit.com': 'Reddit',
  'bilibili.com': '哔哩哔哩',
  'zhihu.com': '知乎',
  'weibo.com': '微博',
  'douyin.com': '抖音',
  'tiktok.com': 'TikTok',
  'instagram.com': 'Instagram',
  'facebook.com': 'Facebook',
  'linkedin.com': 'LinkedIn',
  'stackoverflow.com': 'Stack Overflow',
  'wikipedia.org': 'Wikipedia',
  'chatgpt.com': 'ChatGPT',
  'claude.ai': 'Claude',
  'huggingface.co': 'Hugging Face',
  'arxiv.org': 'arXiv',
  'medium.com': 'Medium',
  'xiaohongshu.com': '小红书',
};

/** 标题套话多：不要用「上的」「帖子」当组名；忙则按作者拆 */
export const TEMPLATE_SITES = new Set([
  'x.com',
  'weibo.com',
  'instagram.com',
  'xiaohongshu.com',
  'tiktok.com',
  'douyin.com',
]);

const TEMPLATE_BRANDS = {
  'x.com': ['X', 'Twitter'],
  'weibo.com': ['微博', 'Weibo'],
  'instagram.com': ['Instagram'],
  'xiaohongshu.com': ['小红书', 'Xiaohongshu', 'RED'],
  'tiktok.com': ['TikTok'],
  'douyin.com': ['抖音', 'Douyin'],
};

/** 同站标签很多时按路径第一段拆开（GitHub owner、X handle 等） */
const PATH_GROUP_SITES = {
  'github.com': new Set([
    'settings', 'notifications', 'pulls', 'issues', 'marketplace', 'explore',
    'topics', 'orgs', 'users', 'login', 'signup', 'new', 'dashboard', 'search',
    'copilot', 'codespaces', 'sponsors', 'about', 'features', 'pricing',
    'security', 'enterprise', 'customer-stories', 'readme', 'discussions',
  ]),
  'gitlab.com': new Set([
    'dashboard', 'explore', 'users', 'help', 'signin', 'signup', 'groups',
  ]),
  'x.com': new Set([
    'i', 'home', 'explore', 'search', 'notifications', 'messages', 'settings',
    'compose', 'intent', 'hashtag', 'share', 'login', 'signup', 'following',
    'followers', 'communities', 'premium', 'jobs', 'grok', 'articles', 'lists',
    'bookmarks', 'highlights', 'tos', 'privacy', 'about', 'help', 'download',
    'flow', 'account', 'oauth', 'embed', 'topics', 'happenings',
  ]),
  'instagram.com': new Set([
    'p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct', 'about',
    'legal', 'developer', 'directory', 'tv', 'igtv', 'live', 'tags', 'locations',
  ]),
  'tiktok.com': new Set([
    'foryou', 'following', 'search', 'live', 'discover', 'inbox', 'friends',
    'video', 'music', 'tag', 'place', 'login', 'signup', 'about', 'embed',
    'share', 'upload', 'messages', 't', 'v', 'explore',
  ]),
};

const JUNK_EXACT = new Set([
  '上的', '中的', '里的', '下的', '后的', '前的', '时的', '到的',
  '的帖', '帖子', '的推', '推文', '主页', '用户', '分享', '查看',
  'on', 'of', 'to', 'in', 'for', 'and', 'the', 'a', 'an',
  'with', 'from', 'by', 'at', 'as', 'or', 'is',
]);

/** 标题/路径里常见、不能当主题名的词 */
const GENERIC_TOKENS = new Set([
  ...JUNK_EXACT,
  'intro', 'guide', 'tutorial', 'docs', 'documentation', 'official',
  'home', 'blog', 'learn', 'getting', 'started', 'overview', 'index',
  'page', 'post', 'posts', 'article', 'com', 'org', 'net', 'http', 'https',
  'www', 'html', 'watch', 'status', 'wiki', 'search', 'login', 'signup',
  'about', 'help', 'faq', 'new', 'edit', 'settings',
  '入门', '教程', '指南', '官方', '文档', '首页', '登录', '搜索',
  '一个', '我们', '可以', '这个', '那个', '什么', '怎么', '没有',
]);

const SITE_TOKEN_LOWER = new Set([
  ...Object.values(SITE_LABELS).map((s) => s.toLowerCase()),
  ...Object.keys(SITE_LABELS),
  ...Object.keys(SITE_ALIASES),
  ...Object.values(SITE_ALIASES),
]);

export function canonicalSite(domain) {
  const d = String(domain || '').toLowerCase();
  if (!d) return '';
  return SITE_ALIASES[d] || d;
}

export function siteLabel(domain) {
  const key = canonicalSite(domain);
  if (!key) return '';
  return SITE_LABELS[key] || key;
}

export function isTemplateSite(domain) {
  return TEMPLATE_SITES.has(canonicalSite(domain));
}

export function siteOfTab(tab) {
  const url = tab?.url;
  try {
    const host = new URL(String(url || '')).hostname.replace(/^www\./, '').toLowerCase();
    if (HOST_ALIASES[host]) return canonicalSite(HOST_ALIASES[host]);
  } catch {
    /* ignore */
  }
  return canonicalSite(registrableDomain(url) || '');
}

export function pathOwner(tab) {
  const site = siteOfTab(tab);
  const reserved = PATH_GROUP_SITES[site];
  if (!reserved) return '';
  try {
    const owner = decodeURIComponent(
      new URL(String(tab?.url || '')).pathname.split('/').filter(Boolean)[0] || '',
    ).replace(/^@/, '');
    if (!owner || reserved.has(owner.toLowerCase())) return '';
    if (!/^[A-Za-z0-9._-]+$/.test(owner)) return '';
    if (/^\d+$/.test(owner)) return '';
    return owner;
  } catch {
    return '';
  }
}

function normalizeHandle(s) {
  return String(s || '').trim().replace(/^@/, '').toLowerCase();
}

function formatPathOwner(site, owner) {
  const raw = String(owner || '').replace(/^@/, '');
  if (!raw) return '';
  if (site === 'x.com' || site === 'instagram.com' || site === 'tiktok.com') {
    return `@${raw}`.slice(0, 24);
  }
  return raw.slice(0, 24);
}

function isAuthorGroupName(name, tabs) {
  const want = normalizeHandle(name);
  if (!want || isJunkGroupName(want)) return false;
  const owners = new Set(
    (tabs || []).map((t) => normalizeHandle(pathOwner(t))).filter(Boolean),
  );
  return owners.size === 1 && owners.has(want);
}

/** 套话站标题去掉「在 X 上的帖子」等壳，剩下才是正文 */
export function contentTitle(tab) {
  const site = siteOfTab(tab);
  let t = String(tab?.title || '').trim();
  if (!t || !isTemplateSite(site)) return t;
  const brands = TEMPLATE_BRANDS[site] || [siteLabel(site)];
  for (const brand of brands) {
    const q = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const onBody = t.match(new RegExp(`^.+?\\s+on\\s+${q}:\\s*(.+)$`, 'i'));
    if (onBody) {
      t = onBody[1].trim().replace(/^["「『]|["」』]$/g, '').trim();
      break;
    }
    t = t
      .replace(new RegExp(`\\s*在\\s*${q}\\s*上的(?:帖子|笔记|视频|作品|动态)?\\s*$`, 'i'), '')
      .replace(new RegExp(`\\s*在\\s*${q}\\s*上\\s*$`, 'i'), '')
      .replace(new RegExp(`\\s+on\\s+${q}\\s*$`, 'i'), '')
      .replace(new RegExp(`\\s*[\\/·|\\-]\\s*${q}\\s*$`, 'i'), '')
      .trim();
  }
  const owner = pathOwner(tab);
  if (owner && t.toLowerCase() === owner.toLowerCase()) return '';
  return t;
}

export function isJunkGroupName(name) {
  const s = String(name || '').trim();
  if (!s) return true;
  if ([...Object.values(SITE_LABELS)].includes(s)) return false;
  if (s.length < 2) return true;
  if (JUNK_EXACT.has(s) || JUNK_EXACT.has(s.toLowerCase())) return true;
  if (/^[一-鿿]的$/.test(s) || /^的[一-鿿]$/.test(s)) return true;
  return false;
}

export function majoritySite(tabs, minShare = 0.67) {
  const freq = new Map();
  for (const t of tabs || []) {
    const s = siteOfTab(t);
    if (!s) continue;
    freq.set(s, (freq.get(s) || 0) + 1);
  }
  let best = '';
  let bestN = 0;
  for (const [s, c] of freq) {
    if (c > bestN) {
      best = s;
      bestN = c;
    }
  }
  const denom = (tabs || []).length;
  if (!best || !denom || bestN / denom < minShare) return '';
  return best;
}

export function finalizeGroupName(name, tabs) {
  const site = majoritySite(tabs);
  const label = site ? siteLabel(site) : '';
  const raw = String(name || '').trim();
  if (site && isTemplateSite(site)) {
    if (isAuthorGroupName(raw, tabs)) return formatPathOwner(site, raw);
    return label;
  }
  if (isJunkGroupName(raw)) return label || '分组';
  if (site && (canonicalSite(raw) === site || raw === site)) return label;
  return raw.slice(0, 24);
}

function dedupeTabs(tabs) {
  const seen = new Set();
  const out = [];
  for (const t of tabs || []) {
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

function asGroup(name, tabs) {
  const uniq = dedupeTabs(tabs);
  return {
    key: name,
    name,
    tabs: uniq,
    tabIds: uniq.map((t) => t.id),
  };
}

export function tokenizeTitle(text) {
  const tokens = [];
  const s = String(text || '');
  for (const m of s.matchAll(/[A-Za-z][A-Za-z0-9+#._-]{1,24}/g)) {
    tokens.push(m[0].toLowerCase());
  }
  for (const m of s.matchAll(/[一-鿿]{2,8}/g)) {
    const run = m[0];
    for (let len = 2; len <= run.length; len += 1) {
      for (let i = 0; i + len <= run.length; i += 1) {
        tokens.push(run.slice(i, i + len));
      }
    }
  }
  return [...new Set(tokens)].filter(
    (t) => t.length >= 2 && !GENERIC_TOKENS.has(t) && !GENERIC_TOKENS.has(t.toLowerCase()) && !isJunkGroupName(t),
  );
}

function isSiteishToken(tok) {
  return SITE_TOKEN_LOWER.has(String(tok || '').toLowerCase());
}

function displayToken(tok) {
  const s = String(tok || '');
  if (/^[a-z]/.test(s)) return s.charAt(0).toUpperCase() + s.slice(1);
  return s;
}

function urlPathTokens(tab) {
  try {
    const parts = new URL(String(tab?.url || '')).pathname.split('/').filter(Boolean);
    const out = [];
    for (const p of parts.slice(0, 4)) {
      const decoded = decodeURIComponent(p).replace(/\.[a-z0-9]+$/i, '');
      out.push(...tokenizeTitle(decoded));
    }
    return out;
  } catch {
    return [];
  }
}

function tokensOfTab(tab) {
  const title = isTemplateSite(siteOfTab(tab)) ? contentTitle(tab) : (tab?.title || '');
  return new Set([
    ...tokenizeTitle(title),
    ...tokenizeTitle(pathOwner(tab)),
    ...urlPathTokens(tab),
  ]);
}

function siteBucketsOnly(items) {
  const buckets = new Map();
  const ungrouped = [];
  for (const item of items || []) {
    const key = siteOfTab(item);
    if (!key) {
      ungrouped.push(item);
      continue;
    }
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  }
  const groups = [];
  for (const [key, tabs] of buckets) {
    if (tabs.length >= 2) groups.push(asGroup(siteLabel(key), tabs));
    else ungrouped.push(...tabs);
  }
  return { groups, ungrouped };
}

/**
 * 预览组是否只是「某站的桶」（不是 React / facebook 这种主题或 owner 名）。
 * 主题组不要按站点并进已有 GitHub。
 */
export function groupIsSiteish(g) {
  const name = String(g?.name || '').trim();
  const tabs = g?.tabs || [];
  const site = majoritySite(tabs);
  if (!site || !name) return false;
  const label = siteLabel(site);
  const n = name.toLowerCase();
  return n === String(label).toLowerCase() || canonicalSite(name) === site || n === site;
}

/**
 * 未成组 + 非套话残词组里，把跨站重复出现的标题/路径词剥成主题组。
 * 套话站只用剥壳后的正文；从已有组抽走标签时，避免把该组抽成只剩 1 条。
 */
function peelCrossSiteTopics(preview) {
  const flexible = [...(preview?.groups || [])];
  const ungroupedPool = [...(preview?.ungrouped || [])];
  const pool = [...flexible.flatMap((g) => g.tabs), ...ungroupedPool];

  const groupOf = new Map();
  for (const g of flexible) {
    for (const t of g.tabs) groupOf.set(t.id, g);
  }

  const byTok = new Map();
  for (const t of pool) {
    const site = siteOfTab(t);
    for (const tok of tokensOfTab(t)) {
      if (isSiteishToken(tok) || GENERIC_TOKENS.has(tok)) continue;
      if (!byTok.has(tok)) byTok.set(tok, { tabs: new Map(), sites: new Set() });
      const rec = byTok.get(tok);
      rec.tabs.set(t.id, t);
      if (site) rec.sites.add(site);
    }
  }

  const poolN = pool.length;
  const candidates = [];
  for (const [tok, rec] of byTok) {
    if (rec.tabs.size < 2 || rec.sites.size < 2) continue;
    if (/^\d+$/.test(tok)) continue;
    // 池子够大时才挡泛滥词；两三个标签共享的词往往就是主题
    if (poolN >= 6 && rec.tabs.size / poolN > 0.55) continue;
    candidates.push({ tok, tabs: [...rec.tabs.values()] });
  }
  candidates.sort((a, b) => b.tok.length - a.tok.length || b.tabs.length - a.tabs.length);

  const used = new Set();
  const topicGroups = [];
  for (const c of candidates) {
    const tabs = c.tabs.filter((t) => !used.has(t.id));
    const accepted = [];
    const byGroup = new Map();
    for (const t of tabs) {
      const g = groupOf.get(t.id);
      if (!g) {
        accepted.push(t);
        continue;
      }
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(t);
    }
    for (const [g, matched] of byGroup) {
      const remain = g.tabs.length - matched.length;
      const share = matched.length / g.tabs.length;
      if (remain === 0 || remain >= 2 || share >= 0.67) accepted.push(...matched);
    }
    const sites = new Set(accepted.map((t) => siteOfTab(t)).filter(Boolean));
    if (accepted.length < 2 || sites.size < 2) continue;
    for (const t of accepted) used.add(t.id);
    topicGroups.push(asGroup(displayToken(c.tok).slice(0, 24), accepted));
  }

  const leftoverTabs = [];
  const leftoverGroups = [];
  for (const g of flexible) {
    const tabs = g.tabs.filter((t) => !used.has(t.id));
    if (tabs.length >= 2) leftoverGroups.push(asGroup(g.name, tabs));
    else leftoverTabs.push(...tabs);
  }
  leftoverTabs.push(...ungroupedPool.filter((t) => !used.has(t.id)));
  const rest = siteBucketsOnly(leftoverTabs);

  const merged = new Map();
  const push = (g) => {
    if (!g || g.tabs.length < 2) return;
    const cur = merged.get(g.name);
    merged.set(g.name, cur ? asGroup(g.name, [...cur.tabs, ...g.tabs]) : g);
  };
  for (const g of topicGroups) push(g);
  for (const g of leftoverGroups) push(g);
  for (const g of rest.groups) push(g);

  const groups = [...merged.values()].filter((g) => g.tabs.length >= 2);
  groups.sort((a, b) => b.tabs.length - a.tabs.length || a.name.localeCompare(b.name, 'zh'));

  const usedIds = new Set(groups.flatMap((g) => g.tabIds));
  const ungrouped = [];
  const seen = new Set();
  for (const t of [...rest.ungrouped, ...ungroupedPool, ...pool]) {
    if (!t || usedIds.has(t.id) || seen.has(t.id)) continue;
    seen.add(t.id);
    ungrouped.push(t);
  }
  return { groups, ungrouped };
}

/**
 * 所有分类后端的统一收尾：套话残词换成站点名，忙的套话站按作者拆，再剥跨站主题。
 */
export function finalizePreview(preview) {
  const ungrouped = [...(preview?.ungrouped || [])];
  const templateBuckets = new Map();
  const restGroups = [];

  const addTemplate = (site, tabs) => {
    const cur = templateBuckets.get(site) || [];
    cur.push(...tabs);
    templateBuckets.set(site, cur);
  };

  for (const g of preview?.groups || []) {
    const tabs = [...(g.tabs || [])];
    if (tabs.length < 2) {
      ungrouped.push(...tabs);
      continue;
    }
    const site = majoritySite(tabs);
    const junk = isJunkGroupName(g.name);
    const peel = !!(site && isTemplateSite(site) && (junk || majoritySite(tabs, 0.8) === site));
    if (peel && !isAuthorGroupName(g.name, tabs)) {
      const mine = [];
      const other = [];
      for (const t of tabs) {
        if (siteOfTab(t) === site) mine.push(t);
        else other.push(t);
      }
      if (mine.length) addTemplate(site, mine);
      if (other.length >= 2) restGroups.push(asGroup(finalizeGroupName(g.name, other), other));
      else ungrouped.push(...other);
      continue;
    }
    restGroups.push(asGroup(finalizeGroupName(g.name, tabs), tabs));
  }

  const merged = new Map();
  const push = (g) => {
    if (g.tabs.length < 2) {
      ungrouped.push(...g.tabs);
      return;
    }
    const cur = merged.get(g.name);
    merged.set(g.name, cur ? asGroup(g.name, [...cur.tabs, ...g.tabs]) : g);
  };
  for (const [site, tabs] of templateBuckets) push(asGroup(siteLabel(site), tabs));
  for (const g of restGroups) push(g);

  const groups = [...merged.values()].filter((g) => g.tabs.length >= 2);
  groups.sort((a, b) => b.tabs.length - a.tabs.length || a.name.localeCompare(b.name, 'zh'));

  const used = new Set(groups.flatMap((g) => g.tabIds));
  const rest = [];
  const seenU = new Set();
  for (const t of ungrouped) {
    if (!t || used.has(t.id) || seenU.has(t.id)) continue;
    seenU.add(t.id);
    rest.push(t);
  }
  return peelCrossSiteTopics(splitBusySiteGroups({ groups, ungrouped: rest }));
}

/** 按站点分组（site 模式）；twitter.com 与 x.com 同一组，显示名用 SITE_LABELS */
export function suggestGroups(items) {
  const buckets = new Map();
  const ungrouped = [];
  for (const item of items) {
    const key = siteOfTab(item);
    if (!key) {
      ungrouped.push(item);
      continue;
    }
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  }
  const groups = [];
  for (const [key, tabs] of buckets) {
    if (tabs.length >= 2) groups.push(asGroup(siteLabel(key), tabs));
    else ungrouped.push(...tabs);
  }
  groups.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  return splitBusySiteGroups({ groups, ungrouped });
}

/**
 * GitHub / X 等：至少两个 owner 各有 ≥2 个标签时才按 owner 拆开，
 * 否则仍合成一个站点组。
 */
function splitBusySiteGroups(preview) {
  const groups = [];
  const ungrouped = [...(preview.ungrouped || [])];
  for (const g of preview.groups || []) {
    const site = majoritySite(g.tabs, 0.8);
    if (!site || !PATH_GROUP_SITES[site]) {
      groups.push(g);
      continue;
    }
    const byOwner = new Map();
    const rest = [];
    for (const t of g.tabs) {
      const owner = pathOwner(t);
      if (!owner) {
        rest.push(t);
        continue;
      }
      const k = owner.toLowerCase();
      if (!byOwner.has(k)) byOwner.set(k, { raw: owner, tabs: [] });
      byOwner.get(k).tabs.push(t);
    }
    const busy = [...byOwner.values()].filter((x) => x.tabs.length >= 2);
    if (busy.length < 2) {
      groups.push(g);
      continue;
    }
    for (const x of busy) groups.push(asGroup(formatPathOwner(site, x.raw), x.tabs));
    const leftover = [
      ...rest,
      ...[...byOwner.values()].filter((x) => x.tabs.length < 2).flatMap((x) => x.tabs),
    ];
    if (leftover.length >= 2) groups.push(asGroup(siteLabel(site), leftover));
    else ungrouped.push(...leftover);
  }
  groups.sort((a, b) => b.tabs.length - a.tabs.length || a.name.localeCompare(b.name, 'zh'));
  return { groups, ungrouped };
}
