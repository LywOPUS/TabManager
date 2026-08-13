# Tab Manager

浏览器扩展：用 OneTab 式收纳释放标签，用 Edge 式整理把标签收成可恢复的会话与分组。

## Language

**Tab（标签）**:
浏览器里一条打开的页面实例（有 tabId、URL、标题等）。
_Avoid_: Page（易与网页文档混淆）, Window

**Window（窗口）**:
一组同屏显示的 Tab 的容器；收纳默认作用于当前 Window。
_Avoid_: 浏览器（指整个应用）

**Stash（收纳）**:
把范围内的 Tab 关闭，并把其元数据写入持久化列表的动作。
_Avoid_: 保存（太泛）, 休眠/discard（本产品 MVP 不采用）
_UI ZH_: 收纳
_UI EN_: Save tabs

**Session（会话）**:
一次收纳产生的、可命名的 Tab 存档单元；恢复与删除以它为主要粒度。
_Avoid_: 集合 Collection, 工作区 Workspace（未采用）
_UI ZH_: 会话
_UI EN_: Tab list

**Group（分组）**:
Session 内的主题子集，可由启发式建议或用户手动调整。
_Avoid_: 文件夹, Tag（标签名易与 Tab 混淆）, Tab Group（那是浏览器原生组）
_UI ZH_: 分组
_UI EN_: Group

**Read Later（稍后阅读）**:
Session 内固定保留的分组；收纳时自动创建（可空）。建议分组不改动其中的标签；用户可手动移入/移出。
_Avoid_: 书签, 收藏夹
_UI ZH_: 稍后阅读
_UI EN_: Read later

**Tab Group（原生标签组）**:
浏览器自带的标签分组；Live Organize 的写入目标。不能跨窗口容纳标签。弹窗「解散全部标签组」拆开全部窗口中的原生组，标签仍打开。
_Avoid_: Group（本产品 Session 内分组）, Session
_UI ZH_: 标签组（仅在需要与「分组」对比时使用）
_UI EN_: Tab group

**StashedTab（存档标签）**:
Session 里一条已收纳项（至少含标题与 URL），不是仍打开的 Tab。
_Avoid_: Bookmark（书签是浏览器另一套系统）
_UI ZH_: 不单独标注类型；列表只显示网页标题
_UI EN_: 同上（show page title only）

**Session Organize（会话整理）**:
对 Session 内 StashedTab 做建议分组（预览→应用）；只改列表，不碰打开的 Tab。
_Avoid_: 整理（太泛，需区分路径）
_UI ZH_: 建议分组；预览操作「应用分组」/「取消」
_UI EN_: Suggest groups；Apply groups / Cancel

**Live Organize（打开标签整理）**:
整理当前窗口：本窗可收纳标签（**含已成组**）按**跨站主题**成组（标题/路径里反复出现的词，如 GitHub 上的 React 与 react.dev →「React」）。已在别的标签组里的也可以抽走重分。X / Instagram / TikTok 等套话站：标题先剥掉「在 X 上的帖子」这类壳；能确定作者或主题时组名用 `X|alice`、`X|React`，不要用「上的」；对不上限定词才落成光秃秃的站点名。对不上主题的，同站 **并入已有原生标签组**（含单条）；同站多个标签组合并为一组；其余再新建。GitHub / GitLab 在至少两个 owner 各有 ≥2 个标签时按所有者拆开。弹窗/右键立刻应用到最近聚焦的普通窗口；管理页先预览再应用。跨窗合并：弹窗确认后立刻并进最近聚焦的普通窗口再整理；管理页先确认。应用后折叠非当前标签组。不写入 Session。跳过 pinned 与不可收纳 URL。
_Avoid_: 收纳, Session Organize, Seed Organize
_UI ZH_: 整理当前窗口；整理全部窗口并合并到当前
_UI EN_: Organize this window；Merge & organize into this window
_UI ZH 确认框_: 标题「合并并整理到当前窗口？」；按钮「合并并整理」/「取消」

**Seed Organize（按当前页归组）**:
独立操作，不是整理当前窗口的默认行为。以当前页为种子，把同作者 / 同主题的标签收进来（**可从已有组抽走**；Alice 的推 → `X|alice`，Bob 不进；react.dev → 把已在 GitHub 组里的 `facebook/react` 收成「React」）。不整理窗口里其余标签。弹窗立刻应用；右键同样。管理页不做（当前页是管理页本身）。
_Avoid_: Live Organize
_UI ZH_: 按当前页归组
_UI EN_: Group around this page

**Management Page（管理页）**:
扩展的主界面：浏览 Session、建议分组、会话内解散、预览整理、跨窗合并、已收纳去重、闲置、设置、导入导出。
_Avoid_: Popup（弹窗只对当前打开的标签立刻动手）, Side Panel（非 MVP 主壳）
_UI ZH_: 标签管理
_UI EN_: Tab Manager
_UI ZH 空状态_: 还没有会话 — 收纳其他标签开始

## 弹窗 vs 管理页

| 操作 | 弹窗 | 管理页 |
| --- | --- | --- |
| 收纳其他标签 / 连当前页 | 立刻收纳 | 立刻收纳 |
| 恢复 | 最近一个会话 | 任意会话 / 分组 |
| 整理当前窗口 | 立刻成组（最近聚焦的窗口，含已成组可重分） | 预览 + 分类设置后应用（管理页所在窗口） |
| 按当前页归组 | 立刻把同作者/同主题收到当前页这边 | — |
| 解散全部标签组 | 全部窗口的原生标签组 | — |
| 合并重复网页 | 全部窗口中**打开的**标签 | 打开的标签 + **已收纳**会话 |
| 会话内解散分组 | — | 主题组并入「未分组」 |
| 合并并整理全部窗口 | 确认后立刻合并并整理 | 确认后合并重建 |
| 闲置 / 分类设置 / 导入导出 | — | 有 |

## UI copy (locked)

| 场景 | ZH | EN |
| --- | --- | --- |
| 收纳动作 | 收纳其他标签 | Save other tabs |
| 收纳（含当前页） | 连当前页一起收纳 | Save including this tab |
| 右键 | 收纳当前窗口（保留当前页） / 收纳全部窗口（保留当前页） | Save tabs in this window (keep current) / Save tabs in all windows (keep current) |
| 快捷键 | Alt+Shift+S 收纳其他标签；Alt+Shift+M 打开标签管理 | Alt+Shift+S save other tabs; Alt+Shift+M open Tab Manager |
| 单条打开 | 打开 | Open |
| 整会话恢复 | 全部恢复 | Restore all |
| 恢复并删会话 | 恢复并删除会话（无独立领域术语） | Restore and delete |
| Session 内分组 | 分组 | Group |
| 建议分组预览 | 应用分组 / 取消 | Apply groups / Cancel |
| Live 单窗 | 整理当前窗口 | Organize this window |
| 按当前页归组 | 按当前页归组 | Group around this page |
| Live 跨窗 | 整理全部窗口并合并到当前 / 弹窗「合并全部窗口」 | Merge & organize into this window |
| 跨窗确认 | 合并并整理到当前窗口？ / 合并并整理 / 取消 | Merge and organize into this window? / Merge & organize / Cancel |
| 管理页标题 | 标签管理 | Tab Manager |
| 打开管理页 | 打开标签管理 | Open Tab Manager |
| 解散全部标签组 | 解散全部标签组 | Ungroup all tab groups |
| 打开标签去重 | 合并重复网页（全部窗口） | Merge duplicate pages (all windows) |
