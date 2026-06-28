---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 1b15fa6152c39e6cbe05d76c27235a71_89e91ac3725111f1986d525400d9a7a1
    ReservedCode1: m08kI/RXbJCYmnthSDh3YgcbGvecrIJlLlcMaNnQ0EbINJR6H/dBK97Qk3PjEiI5PVpf/NkKkDqE7TGZDuEF/CVo4EGzSMS/N9Y2wclXM94AIcEZbiZz4uStL+dJjVxIN40zrU9CGzxmwHYJRXe3RtQNxdQNCd8HjnmMqsaWKgYVuruwv8788BsVxYo=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 1b15fa6152c39e6cbe05d76c27235a71_89e91ac3725111f1986d525400d9a7a1
    ReservedCode2: m08kI/RXbJCYmnthSDh3YgcbGvecrIJlLlcMaNnQ0EbINJR6H/dBK97Qk3PjEiI5PVpf/NkKkDqE7TGZDuEF/CVo4EGzSMS/N9Y2wclXM94AIcEZbiZz4uStL+dJjVxIN40zrU9CGzxmwHYJRXe3RtQNxdQNCd8HjnmMqsaWKgYVuruwv8788BsVxYo=
---

# 插件例子：7 个接地气的具体实现方案

> 以下是基于 SimpleTextReader v1.6.12 实际代码架构，可立即着手开发的 7 个插件例子。每个例子标注了精确的 Hook 点位置、数据流入口和核心实现思路。

---

## 例子一：简繁转换器（T2S Converter）

**解决什么问题**：很多用户下载的 TXT/EPUB 是繁体中文，读起来费力。这个插件在书籍加载后自动将繁体转为简体，阅读过程中完全无感知。

**挂在哪个 Hook 点**：`file:afterProcess`

为什么是这个点？看 `FileHandler.handleMultipleFiles()` 的流程——文件被 `FileProcessor`（TXT）或 `EpubConverter`（EPUB）处理完后，会产出一个统一数据结构（`FILE_CONTENT_CHUNKS` + `ALL_TITLES`），然后渲染到页面。在 `file:afterProcess` 这个位置，所有文本行已在数组中，改完直接交给下游渲染，不需要碰 DOM。

**实现思路**：

```
1. 在 file:afterProcess 注册回调（priority=90，确保在核心渲染之前执行）
2. 回调收到的 payload 包含 { fileContentChunks, allTitles }
3. 遍历所有 chunks，对每行的 text 字段调用 OpenCC（开放中文转换）的 WASM 版本做简繁映射
4. 因为是纯字符串替换，不涉及 DOM，性能可控（百万字级别也在 200ms 内）
5. 在设置面板注册一个开关："加载时自动转换为简体"，默认开启
```

**具体 hook 注册**：`cbReg.add("file:afterProcess", convertToSimplified, { priority: 90, namespace: "plugins/t2s" })`

**依赖**：OpenCC 的 JS/WASM 版本，约 200KB（或自维护一份常用字映射表，约 50KB）

**用户能直观感受到**：打开一本繁体《三体》，读到的就是简体，不需要任何手动操作。

---

## 例子二：番茄阅读钟（Pomodoro Reader）

**解决什么问题**：很多人想培养阅读习惯但容易分心。这个插件在工具栏显示一个倒计时，阅读满 25 分钟弹窗提醒休息，同时统计每日阅读时长。

**挂在哪个 Hook 点**：
- `reader:toolbarRender` — 在工具栏注入计时器按钮和倒计时显示
- `reader:progressChange` — 检测用户是否在翻页（翻页 = 在阅读 = 计时器继续走）

**实现思路**：

```
1. 工具栏注入一个按钮，点击展开/收起计时器面板（复用现有的 dropdown-selector.js 模式）
2. 计时器面板显示：当前番茄钟倒计时（默认 25 分钟）+ 今日累计阅读时长
3. 监听 reader:progressChange：每次翻页视为"活跃信号"，计时器继续
4. 若 2 分钟内无翻页事件 → 暂停计时器（用户可能走开了）
5. 番茄钟结束时：浏览器 Notification API 弹提醒，同时弹出 PopupManager 建议休息
6. 阅读时长存入插件专属 IndexedDB 命名空间，按日期聚合
7. 在设置面板注册自定义番茄时长（15/25/35 分钟）
```

**具体 hook 注册**：

```javascript
// 安装定时器 UI
hooks.on("reader:toolbarRender", (toolbarEl) => {
  const timerBtn = createPomodoroButton();
  toolbarEl.appendChild(timerBtn);
}, { namespace: "plugins/pomodoro" });

// 监听翻页保持计时
hooks.on("reader:progressChange", () => {
  pomodoroState.lastActivity = Date.now();
}, { namespace: "plugins/pomodoro" });
```

**用户能直观感受到**：工具栏多了一个番茄图标，点开会看到"剩余 18:42 | 今日已读 1h23m"。

---

## 例子三：一键导出 Markdown（Export to Markdown）

**解决什么问题**：用户读完一本好书想保存为 Markdown 做笔记或发布到博客，目前只能看到分页渲染的 HTML，没有导出能力。

**挂在哪个 Hook 点**：`reader:toolbarRender`（注入按钮）+ 直接读取 `FILE_CONTENT_CHUNKS`（数据已在全局 `CONFIG.RUNTIME_VARS` 中）

**实现思路**：

```
1. 工具栏注入"导出 Markdown"按钮
2. 点击后从 CONFIG.RUNTIME_VARS 中读取当前书籍的 FILE_CONTENT_CHUNKS 和 ALL_TITLES
3. 构建 Markdown：
   - 书籍名 → # 一级标题
   - ALL_TITLES 每个标题 → ## 二级标题
   - 正文段落 → 空行分隔的纯文本
4. 生成 Blob，触发浏览器下载（文件名：书名.md）
5. 在设置面板注册选项：
   - 是否包含章节目录（table of contents）
   - 是否在每段前加段落编号
```

**为什么不需要新增 Hook 点**：`FILE_CONTENT_CHUNKS` 已经在 `CONFIG.RUNTIME_VARS` 中全局可访问（`app.js` 初始化的 `resetVars` 阶段设置的），插件直接 `import * as CONFIG from "../../config/index.js"` 就能拿到。

**用户能直观感受到**：读完一本书点一下按钮，桌面多了一个 `三体.md`，用 Typora 打开结构清晰，可以直接开始写读后感。

---

## 例子四：自定义标签书架（Custom Tag Bookshelf）

**解决什么问题**：书架目前只能按"全部/未完成/已完成"三个维度筛选。书多了（比如 100+ 本），用户想按"科幻/历史/技术/网文"等自定标签分类查找。

**挂在哪个 Hook 点**：
- `bookshelf:filterExtend` — 扩展筛选栏
- `bookshelf:coverGenerate` — 在封面上叠加标签小圆点
- `settings:registerSection` — 注册标签管理设置面板

**实现思路**：

```
1. 书籍处理完成后（或书架展示时），在每本书的封面卡上注入一个"添加标签"小按钮
2. 点击后弹出标签选择器（复用 dropdown-selector.js），支持多选已有标签或新建标签
3. 标签数据存入插件专属 IndexedDB（bookId → tags[] 映射表）
4. 书架顶部筛选栏注入"按标签筛选"下拉框（通过 bookshelf:filterExtend）
5. 设置面板注册"标签管理"分区：创建/删除/重命名标签，支持标签颜色
```

**具体 hook 注册**：

```javascript
// 注册筛选栏扩展
hooks.on("bookshelf:filterExtend", (filterBarData) => {
  filterBarData.filters.push({
    type: "tags",
    label: { zh: "按标签", en: "By Tag" },
    onFilter: (books, selectedTags) => {
      return books.filter(b => hasAnyTag(b.id, selectedTags));
    }
  });
}, { namespace: "plugins/book-tags" });

// 注册设置面板
hooks.on("settings:registerSection", (sections) => {
  sections.push({
    id: "book-tags",
    label: { zh: "标签管理", en: "Tag Management" },
    items: [/* tag CRUD 设置项 */]
  });
}, { namespace: "plugins/book-tags" });
```

**用户能直观感受到**：书架顶部多了一个标签下拉框，选"科幻"只显示科幻书；每本书封面上有几个彩色小圆点标记它的标签。

---

## 例子五：生词/名句高亮器（Vocabulary Highlighter）

**解决什么问题**：读英文书时想标记生词、读中文书时想标记成语或名句。这个插件让用户维护一个"关注词列表"，阅读时自动高亮文中出现的这些词。

**挂在哪个 Hook 点**：`reader:pageRender`（每页内容渲染后扫描）+ `settings:registerSection`（词表管理界面）

**实现思路**：

```
1. 在设置面板注册"高亮词表"分区，用户逐行输入想要高亮的词（每行一个）
2. 词表存入插件 IndexedDB，可导入/导出 JSON
3. 在 reader:pageRender 注册回调，每页渲染后：
   - 遍历页面 DOM 中的文本节点
   - 对每个文本节点用词表做匹配
   - 匹配到的词用 <mark class="plugin-vocab-highlight"> 包裹
4. 高亮样式通过 CSS Variables 注入（复用 variables.css 体系）：
   - 默认黄色背景，可在设置面板调色
5. 悬停高亮词时显示释义浮窗（如果用户填写了释义）
```

**具体 hook 注册**：

```javascript
hooks.on("reader:pageRender", (pageData) => {
  const container = pageData.containerEl; // 当前页根元素
  const wordList = vocabStore.getAll();   // 从插件 storage 读词表
  highlightWordsInDOM(container, wordList);
}, { priority: 10, namespace: "plugins/vocab-highlight" });
```

**为什么用 `reader:pageRender` 而不是 `file:afterProcess`**：因为阅读器是分页渲染的（`pagination-calculator.js` 决定每页显示哪些行），直接改全量文本无法应对不同分页模式。在每页渲染后做 DOM 扫描更可靠。

**用户能直观感受到**：打开英文小说，不认识的单词自动标黄，鼠标悬停能看释义，读完一本书记了几十个生词。

---

## 例子六：每日阅读统计卡片（Reading Stats Dashboard）

**解决什么问题**：用户想知道自己这周读了多少、什么时间段读书最多、哪本书读得最久。给阅读这件事增加一点"游戏化"的正反馈。

**挂在哪个 Hook 点**：
- `reader:progressChange` — 每次翻页记录时间戳 + 书名 + 页码
- `reader:toolbarRender` — 注入统计面板入口按钮

**实现思路**：

```
1. 监听 reader:progressChange，每次翻页写入一条记录到插件 IndexedDB：
   { timestamp, bookId, bookName, pageNum, totalPages }
2. 工具栏注入"阅读统计"按钮，点击弹出 PopupManager 浮窗显示：
   - 今日阅读时长（估算：页数 × 平均每页阅读时间）
   - 本周每日柱状图（Canvas 或纯 CSS 绘制）
   - 本月阅读排行榜（按总阅读页数降序）
   - 连续阅读天数
3. 每天首次打开时，用 Notification API 推送"昨日阅读回顾"
4. 设置面板注册：
   - 每日阅读目标（页数）
   - 是否开启桌面通知
   - 数据导出为 CSV
```

**具体 hook 注册**：

```javascript
hooks.on("reader:progressChange", ({ bookId, bookName, pageNum, totalPages }) => {
  statsStore.record({ bookId, bookName, pageNum, totalPages, timestamp: Date.now() });
}, { namespace: "plugins/reading-stats" });
```

**为什么用 "估算" 而非精确计时**：因为翻页间隔 ≠ 阅读速度（用户可能翻到一页然后去喝水）。但长期来看，页数 × 平均速度的估算是够用的。如果需要精确计时，可以配合例子二的番茄钟插件共享数据。

**用户能直观感受到**：工具栏点开统计，看到"本周已读 427 页，超过 89% 的用户"，读书变成了一种可量化的小成就。

---

## 例子七：AI 章节一句话摘要（AI Chapter One-liner）

**解决什么问题**：长篇小说或技术书籍章节很多，回头看目录时只看到"第三章"这种标题，想不起来讲了什么。这个插件在每个章节标题旁边追加一句 AI 生成的摘要。

**挂在哪个 Hook 点**：
- `file:afterProcess` — 书籍加载后，异步提取各章文本调用 AI API
- `reader:TOCRender` — 目录渲染时把已生成的摘要注入到标题旁边

**实现思路**：

```
1. 在 file:afterProcess 拿到 FILE_CONTENT_CHUNKS 和 ALL_TITLES 后：
   - 按 ALL_TITLES 的分章边界，把每章文本拼接起来
   - 对每章调用 AI API：prompt = "用一句话总结以下章节内容（不超过30字）：\n\n" + chapterText
   - 结果存到 { chapterIndex → summary } 映射表，写入插件 IndexedDB（按 bookId 缓存，避免重复调用）
2. API 调用走 server 端的 token-service.js 模式（密钥存在服务端，不暴露给前端）
3. 在 reader:TOCRender 中，每行目录标题右侧追加 <span class="plugin-ai-summary">摘要文字</span>
4. 设置面板注册：
   - AI 服务选择（本地 Ollama / 云端 API）
   - 摘要字数上限
   - 是否显示在目录中
```

**具体 hook 注册**：

```javascript
hooks.on("file:afterProcess", async ({ fileContentChunks, allTitles, bookId }) => {
  // 异步，不阻塞渲染
  const summaries = await generateChapterSummaries(fileContentChunks, allTitles);
  await summaryStore.set(bookId, summaries);
  // 广播通知：摘要已就绪，请刷新 TOC
  hooks.go("reader:summaryReady", { bookId, summaries });
}, { priority: 5, namespace: "plugins/ai-summary" });

hooks.on("reader:TOCRender", (tocData) => {
  const summaries = summaryStore.get(tocData.bookId);
  if (summaries) {
    tocData.items.forEach(item => {
      if (summaries[item.chapterIndex]) {
        item.suffix = summaries[item.chapterIndex];
      }
    });
  }
}, { namespace: "plugins/ai-summary" });
```

**用户能直观感受到**：打开一本 50 章的网文，目录从"第一章 / 第二章 / ..."变成"第一章：主角穿越到异世界 / 第二章：遇到第一个伙伴 / ..."，看完目录就能回忆起整个故事线。

---

## 八个例子的关系总览

| # | 插件 | Hook 点 | 复杂度 | 适合作为第一个练手插件 |
|---|------|---------|--------|------------------------|
| 1 | 简繁转换 | `file:afterProcess` | 低 | ★★★ 最推荐，纯字符串处理，无 UI |
| 2 | 番茄阅读钟 | `reader:toolbarRender` + `reader:progressChange` | 中 | — |
| 3 | 导出 Markdown | `reader:toolbarRender` + CONFIG 全局读取 | 低 | ★★ 推荐，只用读数据 + 生成 Blob |
| 4 | 自定义标签书架 | `bookshelf:filterExtend` + `settings:registerSection` | 中高 | — |
| 5 | 生词高亮器 | `reader:pageRender` | 中 | — |
| 6 | 阅读统计卡片 | `reader:progressChange` | 中 | ★ 推荐，纯数据记录 + 展示 |
| 7 | AI 章节摘要 | `file:afterProcess` + `reader:TOCRender` | 高 | — |

**建议开发顺序**：先做例子 1 或 3 验证插件加载机制（PluginManager + Hook 注册 + 无 UI 干扰），再做例子 2 或 6 验证 UI 注入（工具栏按钮 + 设置面板），最后做例子 4 或 7 验证多 Hook 协同。
*（内容由AI生成，仅供参考）*
