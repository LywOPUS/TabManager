import { classifyWithBrowserEmbed } from './browserEmbedClassify.js';
import { finalizeGroupName, isJunkGroupName } from './groupLabels.js';

export type ClassifyItem = {
  id?: string | number
  title?: string
  url?: string
  tabId?: string | number
}

export type ClassifyPreviewGroup = {
  key?: string
  name: string
  tabs: ClassifyItem[]
  tabIds: Array<string | number | undefined>
}

export type ClassifyPreview = {
  groups: ClassifyPreviewGroup[]
  ungrouped: ClassifyItem[]
}

export type SuggestGroupsOptions = {
  browserModelId?: string
  preferWebGPU?: boolean
  onStatus?: (text: string) => void
  classifyMode?: string
}

export type SuggestGroupsResult = {
  preview: ClassifyPreview
  source: string
  error?: string
}

type PreviewIn = {
  groups?: Array<{
    name?: string
    tabs?: Array<ClassifyItem | null | undefined>
  }>
  ungrouped?: Array<ClassifyItem | null | undefined>
}

/** 只收模型给出的组：合并同名、丢掉不足 2 条的，不把未分组再按站点收成组 */
function sealPreview(preview: PreviewIn | null | undefined, items: ClassifyItem[] = []): ClassifyPreview {
  const used = new Set<string | number | undefined>();
  const byName = new Map<string, ClassifyPreviewGroup>();
  for (const g of preview?.groups || []) {
    const rawName = String(g.name || '分组').trim().slice(0, 40) || '分组';
    const tabs: ClassifyItem[] = [];
    for (const t of g.tabs || []) {
      if (!t || used.has(t.id)) continue;
      used.add(t.id);
      tabs.push(t);
    }
    if (tabs.length < 2) {
      for (const t of tabs) used.delete(t.id);
      continue;
    }
    const name = isJunkGroupName(rawName) ? finalizeGroupName(rawName, tabs) : rawName;
    const key = name.toLowerCase();
    const cur = byName.get(key);
    if (cur) {
      cur.tabs.push(...tabs);
      cur.tabIds = cur.tabs.map((t) => t.id);
      if (name.length < cur.name.length) {
        cur.name = name;
        cur.key = name;
      }
    } else {
      byName.set(key, { key, name, tabs, tabIds: tabs.map((t) => t.id) });
    }
  }
  const groups = [...byName.values()].filter((g) => g.tabs.length >= 2);
  groups.sort((a, b) => b.tabs.length - a.tabs.length || a.name.localeCompare(b.name, 'zh'));
  const seen = new Set<string | number | undefined>();
  const ungrouped: ClassifyItem[] = [];
  for (const t of items.length ? items : preview?.ungrouped || []) {
    if (!t || used.has(t.id) || seen.has(t.id)) continue;
    seen.add(t.id);
    ungrouped.push(t);
  }
  return { groups, ungrouped };
}

/**
 * 分类引擎唯一实现：浏览器内小模型（embedding 全局主题聚类，套话站也拆）。
 * 失败不回退按站点分组。
 * 兼容旧调用：classifyMode / groupQuality / 远程字段一律忽略。
 */
export async function suggestGroupsSmart(
  items: ClassifyItem[],
  options: SuggestGroupsOptions = {},
): Promise<SuggestGroupsResult> {
  const { browserModelId, preferWebGPU = true, onStatus } = options;

  const finish = (
    preview: PreviewIn,
    source: string,
    extra: { error?: string } = {},
  ): SuggestGroupsResult => ({
    preview: sealPreview(preview, items),
    source,
    ...extra,
  });
  const fail = (error: unknown, source = 'error'): SuggestGroupsResult => {
    const msg = String(error || '分类失败');
    onStatus?.(msg);
    return {
      preview: { groups: [], ungrouped: items || [] },
      source,
      error: msg,
    };
  };

  if (!items.length) {
    return finish({ groups: [], ungrouped: [] }, 'empty');
  }

  try {
    const embedOpts = {
      onStatus,
      modelId: browserModelId,
      preferWebGPU,
    };
    const preview = await classifyWithBrowserEmbed(items, embedOpts);
    if (!preview.groups.length) {
      return fail('浏览器模型没有给出可成组的主题');
    }
    return finish(preview, 'browser-embed');
  } catch (e) {
    console.warn('browser embed failed', e);
    const raw = e instanceof Error ? e.message : String(e);
    return fail(raw.includes('模型') ? raw : `浏览器模型不可用（${raw}）`);
  }
}

export const __test__ = {
  sealPreview,
};
