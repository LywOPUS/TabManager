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

**Tab Group（原生标签组）**:
浏览器自带的标签分组；Live Organize 的写入目标。不能跨窗口容纳标签。
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
对仍打开的 Tab 应用启发式并写入原生 Tab Group；跨窗时先合并进当前 Window 再分组。不写入 Session。
_Avoid_: 收纳, Session Organize
_UI ZH_: 整理当前窗口；整理全部窗口并合并到当前
_UI EN_: Organize this window；Merge & organize into this window
_UI ZH 确认框_: 标题「合并并整理到当前窗口？」；按钮「合并并整理」/「取消」

**Management Page（管理页）**:
扩展的主界面，用于浏览 Session、整理与恢复。
_Avoid_: Popup（popup 仅快捷入口）, Side Panel（非 MVP 主壳）
_UI ZH_: 标签管理
_UI EN_: Tab Manager
_UI ZH 空状态_: 还没有会话 — 收纳当前窗口开始

## UI copy (locked)

| 场景 | ZH | EN |
| --- | --- | --- |
| 收纳动作 | 收纳 | Save tabs |
| 右键 | 收纳当前窗口 / 收纳全部窗口 | Save tabs in this window / Save tabs in all windows |
| 单条打开 | 打开 | Open |
| 整会话恢复 | 全部恢复 | Restore all |
| 恢复并删会话 | 恢复并删除会话（无独立领域术语） | Restore and delete |
| Session 内分组 | 分组 | Group |
| 建议分组预览 | 应用分组 / 取消 | Apply groups / Cancel |
| Live 单窗 | 整理当前窗口 | Organize this window |
| Live 跨窗 | 整理全部窗口并合并到当前 | Merge & organize into this window |
| 跨窗确认 | 合并并整理到当前窗口？ / 合并并整理 / 取消 | Merge and organize into this window? / Merge & organize / Cancel |
| 管理页标题 | 标签管理 | Tab Manager |
| 打开管理页 | 打开标签管理 | Open Tab Manager |
