---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 1b15fa6152c39e6cbe05d76c27235a71_39e28e50725311f1b2f55254006c9bbf
    ReservedCode1: cBXZdejFgfzzyuGQwR4QybXiqU6ft0oDtDo0cKtIIM7sMLUsrx3k/ywFOnOsWkyrGHbX+ZyI4rG9qz90j0x6OA4InW1Nfc8AlgXg0J+pvDdvXLqS8JEFzkyf5UVYN5wHZNwIx0cbIVK+YPex3430clKMu2/JJiC9ONTUNKut4Ls3LJ9WyOzxKQ/HhOo=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 1b15fa6152c39e6cbe05d76c27235a71_39e28e50725311f1b2f55254006c9bbf
    ReservedCode2: cBXZdejFgfzzyuGQwR4QybXiqU6ft0oDtDo0cKtIIM7sMLUsrx3k/ywFOnOsWkyrGHbX+ZyI4rG9qz90j0x6OA4InW1Nfc8AlgXg0J+pvDdvXLqS8JEFzkyf5UVYN5wHZNwIx0cbIVK+YPex3430clKMu2/JJiC9ONTUNKut4Ls3LJ9WyOzxKQ/HhOo=
---

# SimpleTextReader 实用开发方向

> 基于 v1.6.12 源码分析，聚焦日常阅读真实痛点，提出 5 个接地气、可落地的开发方向。每个方向都标注了精确的代码切入点和实现路径。

---

## 方向一：阅读进度全景管理

### 解决什么痛点

现在的阅读器只记录"上次读到哪一行"——关了再开自动跳回去，没了。但读者真正需要的是：知道这本书读了多久、哪天读过、有没有连续打卡、还差多少读完。类似 Apple Books 的"阅读目标"和 Kindle 的"阅读进度百分比"，但完全本地化，不依赖云端。

### 功能设计

- **阅读会话时间线**：每次打开书 → 关闭书的时段自动记录为一次"阅读会话"，包括起止时间、阅读行数、翻页次数
- **日历热力图**：书架上每本书的信息卡片中，用 7×N 的格子展示最近 N 周的阅读热力图（类似 GitHub contribution graph），一眼看出哪天读了哪天没读
- **阅读目标与打卡**：用户可以给自己设"每天读 30 分钟"或"每天读 50 页"，达标当天格子变绿，连续达标有 streak 计数
- **整书阅读进度环**：书架封面下方显示环形进度条（已读页数 / 总页数），配合百分比数字
- **数据完全本地**：全部存在 IndexedDB，不走服务端，匿名模式下不记录

### 代码切入点

| 切入点 | 文件 | 作用 |
|--------|------|------|
| 翻页 / 滚动事件采集 | `reader.js` L55 (SCROLL_EVENT_LISTENER) + L1140+ (handleNavigation) | 每次翻页触发时记录 `{bookId, lineNum, timestamp, pageNum}` |
| 会话管理 | 新增 `reading-session-tracker.js` | 页面 `visibilitychange` 事件检测用户是否在看书；关闭标签页时通过 `beforeunload` 持久化当前会话 |
| IndexedDB 存储 | `db-manager.js` + `bookshelf-db-worker.js` | 新增 `readingSessions` 和 `readingGoals` 两个 object store，利用现有 DBManager 的 Worker 架构 |
| 书架封面 UI | `bookshelf.js` | 在 `updateBookshelf()` 中为每本书追加环形进度组件和 7×N 热力图 |
| 设置面板 | `settings.js` + `helpers-settings.js` (`createRangeItem` / `createCheckboxItem`) | 新增"阅读目标"分区：每日时长目标（slider，5-180 分钟）、每日页数目标、是否启用 streak 提醒 |

### 实现路径

1. **数据采集层**（1 天）：在 `reader.js` 的翻页路径（`gotoNextPage`、`gotoPrevPage`、`handleNavigation`、无限滚动的 `SCROLL_EVENT_LISTENER`）中插入 `sessionTracker.recordPageTurn()` 调用。在 `init-webpage.js` 或 `app.js` 中监听 `visibilitychange`，切到后台时结束当前会话，切回前台时开始新会话（间隔 >10 分钟才算新会话）
2. **存储层**（1 天）：在 `bookshelf-db-worker.js` 的 DB 初始化中新增 `readingSessions` store（索引: bookId + date）和 `readingGoals` store，复用 `DBManager` 的 put/getAll 模式
3. **热力图渲染**（1.5 天）：在 `bookshelf.js` 中，`renderBookCard()` 方法内，查询该书近 12 周的会话数据，用一个 `<div class="reading-streak-grid">` 渲染 7×12 的色块网格（CSS Grid），颜色按阅读时长映射（0=灰, 1-10min=浅绿, 10-30min=绿, 30+=深绿）
4. **进度环**（0.5 天）：用 SVG `<circle>` + `stroke-dasharray` 实现，读取 `PAGE_BREAKS.length` 和当前页码，渲染百分比环形图
5. **设置面板**（1 天）：在 `SETTINGS_SCHEMA` 中新增 `tab: "readingGoals"` 分区，包含每日目标滑块和 streak 通知开关
6. **周报弹窗**（可选，0.5 天）：每周一弹出一个小卡片，总结上周阅读数据（"上周读了 3 天，共 4.2 小时，完成了《三体》23%"）

**工作量估算**：约 1 周。所有改动在 client 端，不涉及服务端。

---

## 方向二：全功能搜索增强

### 解决什么痛点

现有的搜索（`search.js`）功能很基础：输入文本 → 按回车搜索 → 上下导航匹配项。没有大小写开关、没有全词匹配、没有"高亮全部匹配项"、没有搜索历史、不能跨书搜索。读者在读一本几百页的技术书或小说时，经常需要反复搜同一个术语，每次都要重新输入。

### 功能设计

- **搜索选项行**：搜索框下方新增三个 toggle 按钮（大小写敏感 / 全词匹配 / 正则模式），直观展示当前状态
- **高亮全部匹配项**：搜索结果不仅在当前匹配项上高亮，同时在滚动条侧边渲染所有匹配项的位置标记（迷你竖线），一眼看出"这个词在全书中出现在哪些位置"
- **搜索历史**：下拉显示最近 10 次搜索词，点击即可复用，支持清除单条或全部清除
- **跨书搜索**：在搜索框中输入关键词后，如果当前书无结果，自动提示"在书架中搜索其他书"——调用 `search_chunk` 或后端索引查询其他书的内容
- **在当前章节内搜索**：搜索时默认从当前位置向后搜，加一个"仅本章"开关，限定搜索范围为当前章节区间

### 代码切入点

| 切入点 | 文件 | 作用 |
|--------|------|------|
| 搜索对话框 DOM | `search.js` L37-60 (`showDialog` 的 innerHTML) | 在 `.search-body` 中新增搜索选项行（大小写/全词/正则 toggle）和历史下拉 |
| 匹配项滚动条标记 | `search.js` + `reader.css` | 搜索完成后，遍历所有匹配行号，在滚动条容器旁渲染 `<div class="search-marker">` 竖线 |
| 搜索状态管理 | 新增 `search-state.js` | 管理搜索历史（localStorage 存储，最多 10 条）、当前搜索选项、匹配行号列表 |
| 跨书搜索 | `search.js` + `bookshelf.js` | 当前书无匹配时，通过 `search_file(query=...)` 或 `search_chunk` 查询书架中其他书的 file_id |
| 正则编译 | 复用现有 `search.js` L180+ 的正则逻辑 | 当前已支持正则（`new RegExp(input.value)`），增强点在于让用户显式控制是否启用 |

### 实现路径

1. **搜索选项 UI**（1 天）：改造 `showDialog()` 的 HTML 模板，在输入框下方增加三个 `<button class="search-option-toggle">`（Aa / [W] / .*），点击切换 active 状态，样式用现有 CSS Variables 体系，与暗黑模式自动适配
2. **搜索逻辑增强**（1 天）：`search.searchNext()` 和 `search.searchPrev()` 中，读取当前选项状态，构造正则时根据选项追加 `i`（大小写）和 `\b`（全词匹配）修饰符；正则模式开启时对用户输入做 `try { new RegExp(input) }` 异常保护
3. **高亮全部匹配项**（1 天）：在 `search.searchAll()` 中（新增方法），遍历所有 `FILE_CONTENT_CHUNKS`，收集所有匹配行号；在 `.content-container` 或滚动条右侧渲染一个绝对定位的 `<div class="search-markers-bar">`，根据行号比例渲染竖线标记
4. **搜索历史**（0.5 天）：每次执行搜索时将搜索词存入 `localStorage`（key: `searchHistory`，JSON 数组，LIFO 去重），在搜索框获得焦点时显示 `<div class="search-history-dropdown">`
5. **跨书搜索提示**（0.5 天）：当前书无匹配时，搜索框下方显示一行提示"在书房中搜索..."，点击触发 `search_file(query=...)` 调用

**工作量估算**：约 4 天。改动集中在 `search.js` 一个文件，风险极低，不碰渲染管线。

---

## 方向三：快捷键完全自定义

### 解决什么痛点

当前快捷键是硬编码在 `reader.js` 的 `navigationMap` 里的：`ArrowLeft` 翻上页、`ArrowRight` 翻下页、`PageUp/PageDown` 翻章节、`f` 搜索、`g` 跳转行、`Escape` 退出。快捷键可以开关（`SHORTCUTS.arrow_left: true/false`），但不能重新绑定。很多用户习惯不同——有人想用 `j/k`（Vim 风格）翻页，有人想用 `n/p` 翻页，有人纯鼠标操作想把键盘让给其他功能。最糟糕的是：`f` 和 `g` 与浏览器原生搜索/查找功能冲突。

### 功能设计

- **快捷键设置面板**：Settings 中新增"快捷键" tab，以表格形式列出所有可绑定操作（翻上页、翻下页、上一章、下一章、搜索、跳转行、退出阅读、切换目录、切换全屏等），每行显示操作名称 + 当前绑定键 + "重新绑定"按钮
- **绑定冲突检测**：当用户尝试将"翻下页"绑定到已分配给"搜索"的键时，弹出冲突提示，让用户选择覆盖或取消
- **多键组合支持**：支持 `Ctrl+F`、`Shift+Space` 等组合键（存储为 `"ctrl+f"`、`"shift+ "`）
- **预设方案**：提供 3 套预设——默认 / Vim 风格（j=下, k=上, gg=首行, G=末行, /=搜索）/ 纯鼠标模式（全部禁用）
- **导入导出**：快捷键配置作为 JSON 导出/导入，方便备份和跨设备复用

### 代码切入点

| 切入点 | 文件 | 作用 |
|--------|------|------|
| 快捷键定义常量 | `constants.js` L64-90 (`SHORTCUTS`) | 将 `SHORTCUTS` 从 `{arrow_left: true, ...}` 重构为 `{prevPage: "ArrowLeft", nextPage: "ArrowRight", ...}`，value 为键名而非布尔 |
| 导航逻辑 | `reader.js` L1123-1198 (`document.onkeydown`) | 将 `navigationMap` 中的硬编码键改为从 `CONFIG.CONST_CONFIG.SHORTCUTS` 读取，用 `e.key` 匹配而非 `ArrowLeft` 字面量 |
| 设置面板注册 | `settings.js` L89+ (`SETTINGS_SCHEMA`) | 新增 `tab: "shortcuts"` 分区，每个快捷键一个自定义行（操作名 + 当前绑定 + 重新绑定按钮） |
| 键位捕获对话框 | 新增 `shortcut-capture.js` | "重新绑定"按钮点击后弹出模态框，监听下一次按键（包括组合键），格式化为字符串后写回 `CONST_CONFIG.SHORTCUTS` |
| 预设管理 | `helpers-settings.js` | 新增 `createShortcutPresetItem()` 工厂，选项列表为预设名称，选中后批量写入 `SHORTCUTS` 对象 |

### 实现路径

1. **重构快捷键数据结构**（1 天）：将 `constants.js` 中的 `SHORTCUTS` 从布尔值改为键名字符串映射：
   ```js
   SHORTCUTS: {
       prevPage: "ArrowLeft",
       nextPage: "ArrowRight",
       prevChapter: "PageUp",
       nextChapter: "PageDown",
       exit: "Escape",
       search: "f",
       goToLine: "g",
       toggleTOC: null,     // null = 未绑定
       toggleFullscreen: null,
   }
   ```
   同时在 `CONST_CONFIG` 的 localStorage 加载/保存逻辑中适配新结构，确保向后兼容（读取旧布尔值时自动迁移）

2. **改造导航逻辑**（1 天）：将 `reader.js` 中 `navigationMap` 的 key 从 `ArrowLeft` 等字面量改为根据 `SHORTCUTS` 构建反向索引（`key → action`），同时处理组合键（检查 `ctrlKey`、`shiftKey`、`altKey`、`metaKey`）

3. **键位捕获 UI**（1.5 天）：`shortcut-capture.js` 实现弹出模态框 → `addEventListener("keydown")` → 阻止默认行为 → 格式化按键字符串（如 `Ctrl+Shift+F` → `"ctrl+shift+f"`）→ 检测冲突 → 写回 `SHORTCUTS` → 更新 UI 行的显示文本

4. **设置面板集成**（1 天）：在 `SETTINGS_SCHEMA` 中新增 `tab: "shortcuts"`，每个操作一行。复用现有 `createSelectorItem` 并不合适（因为是动态绑定流程），建议实现一个专用的 `createShortcutBindingItem` 工厂：显示操作名（从国际化 key 读取）+ 当前绑定值的 `<kbd>` 标签 + "修改"按钮

5. **导出/导入**（0.5 天）：设置面板底部加两个按钮，"导出快捷键配置"（下载 JSON），"导入快捷键配置"（`<input type="file">` 读取 JSON 后写回 `SHORTCUTS`）

**工作量估算**：约 1 周。改动集中在 `reader.js`、`constants.js`、`settings.js`，不涉及渲染管线。

---

## 方向四：书签与阅读摘抄

### 解决什么痛点

当前阅读器只能"读"，不能"标记"。读者遇到好段落想摘抄下来，目前只能截图或手动复制粘贴到别的笔记软件。这个方向让用户可以：在阅读中按一个键标记当前位置为书签 + 添加标签（如"金句"/"伏笔"/"待查"），或者选中一段文字后一键摘抄保存。所有数据存在本地 IndexedDB，可导出为 Markdown 或纯文本。

### 功能设计

- **快速书签**：在任意阅读位置按 `b`（可自定义）标记书签，弹出简短输入框让用户填写标签（可选），书签以侧边栏列表形式展示，每项显示行号 + 章节名 + 标签 + 正文前 30 字的预览
- **文本摘抄**：选中文字后，工具栏或右键菜单出现"摘抄"按钮，将选中文本 + 书名 + 章节 + 时间戳保存到摘抄列表
- **摘抄/书签管理面板**：书架旁或设置内新增"书签与摘抄"页，按书分组展示所有书签和摘抄，支持搜索、按标签筛选、删除
- **导出**：支持将当前书的所有摘抄导出为 Markdown（自动带书名/章节标题）或纯文本，一键复制全部或按标签筛选导出
- **与阅读进度的联动**：点击书签直接跳转到对应位置，摘抄项也附带跳转链接

### 代码切入点

| 切入点 | 文件 | 作用 |
|--------|------|------|
| 键盘绑定 + 书签保存 | `reader.js` L1123+ (`document.onkeydown`) | 新增 `b` 键绑定，触发 `bookmarkManager.addBookmark()` |
| 文本选区监听 | `reader.js` 或 `text-processor-dom.js` | 监听 `mouseup` 事件，检测选区，弹出浮动工具栏（"摘抄"按钮） |
| IndexedDB 存储 | `db-manager.js` + `bookshelf-db-worker.js` | 新增 `bookmarks` 和 `clippings` 两个 object store |
| 书签侧边栏 | 新增 `bookmarks-panel.js` | 复用 `SidebarSplitView` 的侧边栏架构，在 TOC 侧边栏中新增一个"书签"tab |
| 书签/摘抄管理页 | 新增 `bookmarks-manager.js` | 独立面板页面，通过现有 PopupManager 或新路由展示 |
| 导出功能 | `bookmarks-manager.js` | 调用 `Blob` + `URL.createObjectURL` 触发下载，Markdown 模板包含书名/章节/摘抄内容/时间 |

### 实现路径

1. **数据层**（1 天）：在 `bookshelf-db-worker.js` 中新增 `bookmarks` store（字段：id, bookId, lineNum, chapterTitle, label, preview, timestamp）和 `clippings` store（字段：id, bookId, lineNum, chapterTitle, text, timestamp），注册到 DBManager 的 object stores 列表
2. **书签核心逻辑**（1 天）：新增 `bookmark-manager.js` 作为统一入口，暴露 `addBookmark()`、`removeBookmark()`、`getBookmarks(bookId)`、`addClipping(text)`、`getClippings(bookId)`、`exportAsMarkdown(bookId)` 等方法
3. **键盘书签**（0.5 天）：在 `reader.js` 的 `navigationMap` 中新增 `b` 键处理 → 获取当前行号 → 弹出 `PopupManager` 的小输入框（标签可选）→ 调用 `bookmarkManager.addBookmark()`
4. **文本摘抄**（1 天）：在 `reader.js` 中新增 `mouseup` 事件监听 → 检测 `window.getSelection()` 是否在 `.content-container` 内且非空 → 在选区附近绝对定位一个浮动按钮"摘抄"→ 点击后保存到 clippings store → 弹出 Toast 确认
5. **书签侧边栏 Tab**（1 天）：修改 `reader.processTOC()` 或 `sidebar-splitview.js`，在 TOC 侧边栏顶部新增两个 tab 按钮（"目录" / "书签"），点击"书签"时渲染书签列表（每项可点击跳转）
6. **摘抄管理 + 导出**（1 天）：新增 `bookmarks-manager.js`，通过设置面板入口或书架按钮打开管理面板。面板内按书分组展示所有摘抄，顶部有导出按钮 → `generateMarkdown()` → `Blob` 下载

**工作量估算**：约 1 周。存储层和 UI 层各占一半，改动分散但不涉及渲染管线重构。

---

## 方向五：排版预设方案

### 解决什么痛点

当前的设置面板提供了丰富的排版控制——字体、字号、行高、段间距、背景色、文字色、页面宽度——但每次调好一套舒服的排版需要逐个滑块调整。用户在不同场景下需要不同的排版：白天用黑字白底 + 大字号，晚上用浅灰字深灰底 + 暖色温 + 略小字号，读小说用衬线字体 + 宽行距，读代码/日志用等宽字体。每次切换都要手动调 5-6 个参数，极其繁琐。

### 功能设计

- **保存当前排版为预设**：在设置面板排版相关 tab 底部加一个"保存为预设"按钮，点击弹出命名输入框，将当前所有排版相关 CSS 变量值保存为一个命名预设
- **预设命名与缩略图预览**：每个预设以卡片形式展示，包含预设名称、字体名预览、字号数值、背景色色块、行高数值，用户一目了然
- **一键切换预设**：在阅读界面的工具栏增加一个预设切换下拉按钮（复用现有 `dropdown-selector.js`），选中即可即时切换全部排版参数
- **出厂预设**：提供 3 套出厂预设 —— "经典"（衬线 + 默认字号 + 仿纸色背景）、"现代"（无衬线 + 略大字号 + 纯白背景）、"护眼"（暖色背景 + 偏大行高 + 降低对比度）
- **导入导出**：预设数据为 JSON，支持导出备份和导入恢复

### 代码切入点

| 切入点 | 文件 | 作用 |
|--------|------|------|
| 排版 CSS 变量集合 | `variables.css` | 影响阅读体验的核心变量：`--ui_fontSize`、`--ui_lineHeight`、`--ui_contentWidth`、`--c_bg`、`--c_text`、`--font_family` 等 |
| 设置读写基础设施 | `settings.js` + `CONFIG.RUNTIME_VARS.STYLE` | `applySettings()` → `setDeep()` 可批量写入任意运行时变量，预设就是一键触发多个 `setDeep()` 调用 |
| 预设存储 | `localStorage`（key: `typographyPresets`） | 每个预设是一个 `{name, values: {fontSize, lineHeight, ...}}` 对象 |
| 工具栏下拉组件 | `dropdown-selector.js` | 复用现有组件，在阅读工具栏中新增预设选择器 |
| 设置面板中预设管理 | `settings.js` + `helpers-settings.js` | 在排版相关 tab 底部增加预设卡片列表 + 保存/删除按钮 |

### 实现路径

1. **定义预设 Schema**（0.5 天）：确定哪些 CSS 变量属于"排版预设"范围。建议初始范围：`fontSize`、`lineHeight`、`contentWidth`、`bgColor`（背景色）、`textColor`（文字色）、`fontFamily`（字体族）、`paragraphSpacing`（段间距）。在 `constants.js` 中定义 `TYPOGRAPHY_PRESET_KEYS` 数组
2. **预设管理器**（1 天）：新增 `preset-manager.js`，暴露 `savePreset(name)` → 从 `CONFIG.RUNTIME_VARS.STYLE` 中提取当前排版变量值 → 序列化存到 `localStorage`；`loadPreset(name)` → 从存储中读取 → 逐项调用 `setDeep()` → 触发 `cbReg.go("settingsChanged")`；`deletePreset(name)`；`getAllPresets()` → 返回列表
3. **出厂预设**（0.5 天）：首次加载时检查 `localStorage` 中是否有出厂预设标记，若无则写入 3 套默认预设。预设值参考：
   - "经典"：fontFamily=serif, fontSize=18, lineHeight=1.8, bgColor=#F5F0E8（米白仿纸）, textColor=#333
   - "现代"：fontFamily=sans-serif, fontSize=17, lineHeight=1.6, bgColor=#FFFFFF, textColor=#222
   - "护眼"：fontFamily=system, fontSize=18, lineHeight=2.0, bgColor=#E8E0D0（暖黄）, textColor=#4A4A4A
4. **工具栏下拉切换**（1 天）：在 `reader.js` 的工具栏渲染中（或通过 `reader:toolbarRender` Hook），新增一个预设选择器 `<button>`，点击展开下拉列表显示所有预设名称 → 选中后调用 `presetManager.loadPreset(name)` → 即时生效
5. **设置面板整合**（1 天）：在 `SETTINGS_SCHEMA` 的排版相关 tab 底部，用 DOM 操作追加预设管理区域：预设卡片列表（每个卡片显示预设名 + 缩略信息 + 删除按钮）+ "保存当前排版"按钮。保存时弹出 `PopupManager` 输入框让用户命名
6. **导出导入**（0.5 天）：设置面板底部加两个按钮，导出为 JSON 下载，导入为文件上传后覆盖 `localStorage`

**工作量估算**：约 4-5 天。纯设置层和 UI 层改动，不改渲染逻辑，风险极低。

---

## 总结对比

| 方向 | 解决的核心痛点 | 技术难度 | 工期 | 架构冲击 | 推荐优先级 |
|------|--------------|---------|------|---------|-----------|
| 阅读进度全景管理 | "不知道自己读了多久、有没有坚持" | 低-中 | 1 周 | 小 | ★★★★ |
| 全功能搜索增强 | "搜索功能太简陋，反复搜同一词很烦" | 低 | 4 天 | 极小 | ★★★★★ |
| 快捷键完全自定义 | "快捷键不能改，和习惯冲突" | 中 | 1 周 | 中 | ★★★★ |
| 书签与阅读摘抄 | "看到好段落无法标记和摘抄" | 中 | 1 周 | 中 | ★★★★★ |
| 排版预设方案 | "白天/晚上切换排版要手动调一堆参数" | 低 | 4-5 天 | 极小 | ★★★★★ |

**推荐推进顺序**：排版预设方案 → 全功能搜索增强 → 书签与阅读摘抄 → 阅读进度全景管理 → 快捷键完全自定义。

前三个方向改动小、独立性强、用户感知强，可以在 2 周内全部完成。后两个方向涉及数据采集层和快捷键数据结构重构，建议在前三个方向验证了用户反馈后再推进。
*（内容由AI生成，仅供参考）*
