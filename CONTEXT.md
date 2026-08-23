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
Session 内的主题子集，可由分类模型建议或用户手动调整。
_Avoid_: 文件夹, Tag（标签名易与 Tab 混淆）, Tab Group（那是浏览器原生组）
_UI ZH_: 分组
_UI EN_: Group

**Read Later（稍后阅读）**:
Session 内固定保留的分组；收纳时自动创建（可空）。建议分组不改动其中的标签；用户可手动移入/移出。管理页顶栏可切到「稍后阅读」视图：跨会话集中列出（近似加入顺序倒序），支持搜索 / 打开 / 移出 / 删除与跳回来源会话。
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
整理当前窗口：本窗可收纳标签（**含已成组**）一律走**浏览器内小模型**（embedding 全局主题聚类，套话站也拆）成组，不用按站点/词规则，失败也不回退站点分组。已在别的标签组里的也可以抽走重分。模型组名与已有原生标签组相同时并入，否则新建；同名重复原生组合并。弹窗/右键立刻应用到最近聚焦的普通窗口；管理页先预览再应用。跨窗合并：弹窗确认后立刻并进最近聚焦的普通窗口再整理；管理页先确认。应用后折叠非当前标签组。不写入 Session。跳过 pinned 与不可收纳 URL。
_Avoid_: 收纳, Session Organize, Seed Organize, Selected Organize
_UI ZH_: 整理当前窗口；整理选中标签；整理全部窗口并合并到当前
_UI EN_: Organize this window；Organize selected tabs；Merge & organize into this window
_UI ZH 确认框_: 标题「合并并整理到当前窗口？」；按钮「合并并整理」/「取消」

**Selected Organize（整理选中标签）**:
独立操作。只对标签栏多选（`highlighted`，Ctrl / Shift）的可收纳标签走分类模型成组，**不整理其余标签**，也不合并窗口里未选中的同名组。模型组名与已有原生标签组相同时并入，否则新建。弹窗/右键立刻应用；未多选至少 2 个则提示。管理页不做。
_Avoid_: Live Organize, Seed Organize
_UI ZH_: 整理选中标签
_UI EN_: Organize selected tabs

**Seed Organize（按当前页归组）**:
独立操作，不是整理当前窗口的默认行为。以当前页为种子，用分类模型找出它所在的主题组，把该组标签收进来（**可从已有组抽走**）。不整理窗口里其余标签。弹窗立刻应用；右键同样。管理页不做（当前页是管理页本身）。
_Avoid_: Live Organize, Related Window, Topic Organize
_UI ZH_: 按当前页归组
_UI EN_: Group around this page

**Related Window（相关到新窗口）**:
以当前页为种子，用分类模型找出它所在的主题组，把**各普通窗口**里该组标签移到新窗口并成组。其余标签留在原窗口。弹窗确认后立刻做；右键同样。
_Avoid_: Seed Organize, Merge Organize
_UI ZH_: 相关到新窗口
_UI EN_: Related tabs to new window
_UI ZH 确认框_: 把 N 个「组名」标签移到新窗口并成组？

**Topic Organize（按主题归组）**:
用户输入一个主题，用分类模型分组后取组名对得上的那一组（可从已有组抽走）。弹窗输入后立刻应用。
_Avoid_: Seed Organize
_UI ZH_: 按主题归组
_UI EN_: Group by topic

**Management Page（管理页）**:
扩展的主界面：浏览 Session、建议分组、会话内解散、预览整理、跨窗合并、已收纳去重、闲置、设置、导入导出。浏览器内小模型只在顶栏「模型」下载/删除/清残留；弹窗与整理只从已下载缓存加载，不会发起下载。
_Avoid_: Popup（弹窗只对当前打开的标签立刻动手）, Side Panel（非 MVP 主壳，仅承载建议关闭详细视图）
_UI ZH_: 标签管理
_UI EN_: Tab Manager
_UI ZH 空状态_: 还没有会话

**Suggest Close（建议关闭）**:
从全部窗口打开的 Tab 中挑出「可安全关闭」的，用户勾选后批量关闭。信号 = 启发式（已收纳 / 重复打开 / 已休眠 / 闲置超 1 小时）；浏览器内小模型是 embedding 聚类，判断不了「重要性」，故本功能不走模型。钉住 / 有声 / 各窗口当前页永不参与。详细视图在 Side Panel（按窗口分组、理由筛选、搜索过滤、可附内存占用）；弹窗点「建议关闭」优先开侧栏，API 不可用时回退弹窗内精简面板。
_Avoid_: 关闭（太泛）, Idle Discard（闲置休眠只休眠不关）
_UI ZH_: 建议关闭
_UI EN_: Suggest close

## 弹窗 vs 管理页

| 操作 | 弹窗 | 管理页 |
| --- | --- | --- |
| 收纳 / 连当前页 | 立刻收纳（默认留下当前页） | 立刻收纳 |
| 恢复 | — | 任意会话 / 分组 |
| 整理当前窗口 | 发任务给 background，立刻成组（关弹窗不中断） | 预览 + 分类设置后应用（管理页所在窗口） |
| 整理选中标签 | 只整理标签栏多选（Ctrl / Shift），其余不动 | — |
| 按当前页归组 | 立刻用分类模型把当前页那一组收到一起 | — |
| 相关到新窗口 | 确认后用分类模型把各窗相关标签移到新窗口并成组 | — |
| 按主题归组 | 输入主题后用分类模型成组（当前窗口） | — |
| 解散全部标签组 | 全部窗口的原生标签组 | — |
| 合并重复网页 | 全部窗口中**打开的**标签 | 打开的标签 + **已收纳**会话 |
| 建议关闭 | 优先开侧栏详细视图（回退弹窗内面板） | —（侧栏承载） |
| 稍后阅读集中视图 | — | 跨会话列出 / 打开 / 移出 / 删除 |
| 会话内解散分组 | — | 主题组并入「未分组」 |
| 合并全部窗口 | 确认后立刻合并并整理 | 确认后合并重建 |
| 闲置 / 分类设置 / 模型 / 导入导出 | — | 有（模型：统一下载浏览器内小模型） |

## UI copy (locked)

| 场景 | ZH | EN |
| --- | --- | --- |
| 收纳动作 | 收纳 | Save tabs |
| 收纳（含当前页） | 连当前页一起收纳 | Save including this tab |
| 右键 | 收纳当前窗口（保留当前页） / 收纳全部窗口（保留当前页） | Save tabs in this window (keep current) / Save tabs in all windows (keep current) |
| 快捷键 | Alt+Shift+S 收纳（留下当前页）；Alt+Shift+M 打开标签管理 | Alt+Shift+S stash (keep current); Alt+Shift+M open Tab Manager |
| 单条打开 | 打开 | Open |
| 整会话恢复 | 全部恢复 | Restore all |
| 恢复并删会话 | 恢复并删除会话（无独立领域术语） | Restore and delete |
| Session 内分组 | 分组 | Group |
| 建议分组预览 | 应用分组 / 取消 | Apply groups / Cancel |
| Live 单窗 | 整理当前窗口 | Organize this window |
| Live 选中 | 整理选中标签 | Organize selected tabs |
| 按当前页归组 | 按当前页归组 | Group around this page |
| 相关到新窗口 | 相关到新窗口 | Related tabs to new window |
| 按主题归组 | 按主题归组 | Group by topic |
| Live 跨窗 | 整理全部窗口并合并到当前 / 弹窗「合并全部窗口」 | Merge & organize into this window |
| 跨窗确认 | 合并并整理到当前窗口？ / 合并并整理 / 取消 | Merge and organize into this window? / Merge & organize / Cancel |
| 管理页标题 | 标签管理 | Tab Manager |
| 打开管理页 | 打开标签管理 | Open Tab Manager |
| 解散全部标签组 | 解散全部标签组 | Ungroup all tab groups |
| 打开标签去重 | 合并重复网页（全部窗口） | Merge duplicate pages (all windows) |
| 建议关闭 | 建议关闭 | Suggest close |
