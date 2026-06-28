# SimpleTextReader 创意开发方向

> 基于 v1.6.12 源码深入分析，提出的 5 个非传统开发方向。每个方向都避开了繁简转换、高亮批注、导出 Markdown、番茄钟、标签书架、统计卡片、AI 摘要等常规功能，聚焦于阅读器产品体验本身的创新。

---

## 方向一：章节纹理 (Chapter Textures) —— 给每章一个"视觉指纹"

### 核心创意

每章自动生成一张独特的抽象 SVG 微型图（16×16 或 24×24），嵌入目录侧边栏的章节标题旁。这张图不是随机的，而是通过对该章节文本进行**计算语言学特征提取**生成的"视觉签名"—— 同一本书不同章节纹理各异，同一章节每次生成纹理相同。

纹理的生成维度包括：
- **句子节奏**：长句/短句比例 → 影响图形密度
- **标点密度**：逗号、句号、问号、感叹号的分布 → 影响图形锐度
- **词汇丰富度**：unique words / total words → 影响图形复杂度
- **段落呼吸**：段落长度的方差 → 影响图形节奏感
- **对话比例**：引号内文本占比 → 影响图形纹理方向

这些维度映射到 SVG 的几何属性（多边形顶点数、圆角半径、线条粗细、填充透明度等），形成每章独一无二但又与内容内在关联的视觉标识。

### 为什么有创意

- 不是 AI 生成、不用联网、不需要任何外部依赖 —— 纯算法驱动
- 让目录从"功能性列表"变成"可浏览的风景" —— 扫一眼纹理就知道哪章对话多、哪章描写密集
- 属于"信息可视化"在阅读器中的新颖应用 —— 类似 GitHub 的 contribution heatmap，但用于书籍章节
- 回避了所有常规方向：不是统计、不是摘要、不是标签

### 代码切入点

| 切入点 | 位置 | 作用 |
|---|---|---|
| `TextProcessorCore.process()` | `shared/core/text/text-processor-core.js` | 逐行处理文本时积累特征向量（句长、标点计数、词汇计数） |
| `ALL_TITLES` 结构 | `CONFIG.VARS.ALL_TITLES` | 已有 `[title, lineNum, shortTitle, isCustomOnly]` 四元组，可扩展第五个字段存放特征向量 |
| `reader.processTOC()` | `client/app/modules/features/reader.js` L118-200 | 目录渲染时读取特征向量 → 调用纹理生成器 → 以 inline SVG 形式注入每个 `chapter-title-container` |
| `PaginationCalculator` | `shared/core/text/pagination-calculator.js` | 分页计算时天然拥有章节边界信息，可在 `#addInitialBreakPoints()` 阶段为每个章节区间计算特征 |
| CSS Variables 体系 | `client/css/variables.css` | 纹理的颜色取自当前主题（`--c_*` 变量），确保纹理随暗黑模式自动适配 |

### 实现路径

1. 在 `shared/core/text/` 下新增 `chapter-texture.js`，暴露 `generateTextureSVG(features, themeColors) → string`（返回 SVG markup 字符串）
2. 在 `PaginationCalculator.#addInitialBreakPoints()` 或 `TextProcessorCore` 的批处理阶段，为每对相邻标题之间的文本区间计算特征向量，挂到 `ALL_TITLES[i][4]`
3. 修改 `reader.processTOC()` 中 `generate(i)` 闭包内，读取 `ALL_TITLES[i][4]`，调用纹理生成器，将 `<svg>` 注入 `titleContainer.innerHTML`
4. 纹理 SVG 使用 `currentColor` 和 CSS 变量引用，与 `variables.css` 的 `--c_textMuted` 等变量联动

**工作量估算**：约 3-5 天（核心算法 1 天 + 纹理美学调参 1 天 + 集成和暗黑模式适配 1 天）

---

## 方向二：阅读热力图 (Reading Heatmap) —— 看见自己的阅读行为

### 核心创意

记录用户每次阅读会话中的微观行为（翻页节奏、停留时长、回翻次数、跳读路径），在滚动条侧边叠加一层半透明的**阅读行为热力图**。热力图直观展示：

- 哪些段落你反复读了（高温区 = 红色）
- 哪些章节你快速翻过了（低温区 = 蓝色）
- 你的阅读速度曲线（密度变化）
- 上次阅读结束位置（闪烁锚点）

更关键的是**幽灵回放**：可以回放自己的历史阅读会话 —— 一个半透明的光标/高亮在页面上以 2× 速度重走你的阅读路径，让你看到自己"当时是怎么读这本书的"。如果你有两台设备，可以在设备 B 上回看设备 A 的阅读过程。

### 为什么有创意

- 大多数阅读软件只记录"读到第 X 页"，但没有记录"怎么读的"
- 热力图将阅读行为从"进度百分比"提升为"时空行为数据"，类似 Strava 把跑步从"跑了 5 公里"变成"配速、心率、海拔的可视化轨迹"
- 幽灵回放给人强烈的"时间旅行"感 —— 你和过去的自己共读一本书
- 不需要 AI、不依赖网络、完全本地化、匿名模式下自动禁用记录

### 代码切入点

| 切入点 | 位置 | 作用 |
|---|---|---|
| `reader.SCROLL_EVENT_LISTENER` | `reader.js` L55 | 已有滚动事件监听（无限滚动模式使用），可直接复用或新增专用监听 |
| `cbReg.go("reader:progressChange")` | 已规划 Hook 点 | 每次翻页/滚动到新行时触发，携带 `{lineNum, timestamp, pageNum, direction}` |
| `flowReader.preloadContent()` | `flow-reader.js` L130-200 | 滑动窗口渲染时天然追踪用户滚动位置和方向 |
| `reader._handleTOCClick()` | `reader.js` L90-100 | TOC 跳转是"跳读"行为的关键采集点 |
| BookshelfDB (IndexedDB) | `bookshelf.js` L65+ | 热力图数据按书存储，字段约 `[{lineNum, timestamp, dwellMs, action}]`，每书数据量可控（~2KB/小时阅读） |
| 滚动条 CSS 自定义 | `reader.css` | 滚动条侧边叠加 `<canvas>` 或绝对定位 `<div>` 渲染热力图色块 |
| `CONST_CONFIG.ANONYMOUS_MODE` | `constants.js` L82 | 匿名模式下跳过所有记录 |

### 实现路径

1. 在 `reader.js` 中新增 `heatmapTracker` 对象，在 `reader:progressChange` Hook 上注册回调，每次触发时记录 `{lineNum, timestamp, action: 'scroll'|'toc_jump'|'search_jump'|'goto'}`
2. 每 30 秒批量写入 IndexedDB（复用 `BookshelfDB` 的 `bookProcessed` store 或新增 `readingSessions` store）
3. 在滚动条容器旁新增 `<div id="reading-heatmap">`，用 `<canvas>` 绘制热力图：读取当前书的全部 session 数据，按行号聚合 → 归一化 → 映射色阶 → 渲染到 canvas（高度与滚动条匹配）
4. 幽灵回放：按时间戳排序 session 数据，用 `requestAnimationFrame` 驱动一个半透明指示器在页面上移动，同时 `scrollIntoView` 跟随
5. 设置面板新增"阅读热力图"开关项（复用 `createCheckboxItem` 工厂），全局开关和按书开关两级

**工作量估算**：约 1-2 周（数据采集 2 天 + IndexedDB 存储 1 天 + 热力图渲染 2 天 + 幽灵回放 2 天 + 设置集成 1 天）

---

## 方向三：排版沙盒 (Typography Sandbox) —— 把 CSS 变量变成游乐场

### 核心创意

SimpleTextReader 的 `variables.css` 有 60KB+ 的 CSS 自定义属性体系，`settings.js` 有完整的设置工厂模式（`createRangeItem` / `createCheckboxItem` 等）。但目前的设置项都是"功能性"的（字体、大小、颜色）—— 排版本身没有被当成一个可玩的系统。

**排版沙盒**是一个专门的"实验室"页面/面板，将所有影响阅读体验的 CSS 排版属性以**实时滑块**形式暴露出来，并附带一个**实时预览窗**（加载一段示例文本）：

- `letter-spacing`（字间距）—— 从 -0.05em 到 0.3em
- `word-spacing`（词间距）
- `line-height`（行高）—— 已有，直接复用
- `text-indent`（段首缩进）
- `hanging-punctuation`（标点悬挂）
- `font-variant-numeric`（数字样式：等宽/变宽、旧式/现代）
- `hyphens`（连字符）—— 对英文书籍效果显著
- `text-rendering`（渲染模式：optimizeLegibility vs optimizeSpeed）
- `font-kerning` / `font-feature-settings`（字体微调特性）
- **段落间距** vs **行间距** 的独立控制（当前只有 line-height）
- **阅读宽度**（measure）—— 每行最优字符数，已有 `--ui_contentWidth`

每个滑块旁边实时显示当前值、预设值标记、以及一个"推荐区间"的视觉提示。

### 为什么有创意

- 大多数阅读器把排版设成"字体 + 大小 + 行高 + 颜色"四件套就完了，SimpleTextReader 现有的 CSS Variables 体系天然有能力做更深入的排版控制
- 排版沙盒让普通用户也能体验到"字体排印学 (typography)"的乐趣 —— 类似摄影 app 里的"专业模式"
- 改动只涉及 CSS 变量覆盖，不触及渲染管线，改动风险极低
- 用户调出的参数可以保存为"排版预设"，在书籍间切换

### 代码切入点

| 切入点 | 位置 | 作用 |
|---|---|---|
| `variables.css` | `client/css/variables.css` | 新增 10-15 个排版 CSS 变量（`--t_letterSpacing`, `--t_wordSpacing`, `--t_textIndent` 等） |
| `createRangeItem()` 工厂 | `client/app/utils/helpers-settings.js` | 已有成熟的滑块 UI 工厂，排版沙盒直接复用 |
| `SETTINGS_SCHEMA` | `settings.js` L89+ | 新增 `tab: "typography"` 分区，包含所有排版滑块 |
| `CONFIG.RUNTIME_VARS.STYLE` | `config/variables.js` | 排版变量通过 `setDeep()` 写入运行时配置，与现有设置系统完全一致 |
| `reader.css` / `flow-mode.css` | `client/css/` | CSS 规则中引用 `var(--t_letterSpacing)` 等新变量，应用到 `.content-container` 及其子元素 |
| `applySettings()` 流程 | `settings.js` 后半部分 | 排版沙盒的设置变更走现有 `cbReg.go("settingsChanged")` 通道，无需新机制 |

### 实现路径

1. 在 `variables.css` 的 `:root` 中新增排版变量组（10-15 个），每个有合理默认值
2. 在 `reader.css` 和 `flow-mode.css` 中将关键排版属性从硬编码改为引用 CSS 变量
3. 在 `SETTINGS_SCHEMA` 中新增 `tab: "typography"` 分组，每个排版变量一个 `createRangeItem` 定义
4. 在 `settings.js` 的 `initSettings()` 中为 typography tab 创建面板 DOM（复用现有 tab 切换逻辑）
5. 添加"预设"功能：3 个内置预设（"经典" / "现代" / "舒适"）+ 用户自定义预设保存在 `localStorage`

**工作量估算**：约 1 周（CSS 变量添加与适配 2 天 + 设置面板扩展 2 天 + 预设系统 1 天 + 调参和测试 1 天）

---

## 方向四：双书共读 (Tandem Reading) —— 两本书肩并肩

### 核心创意

将现有 `SidebarSplitView` 的 split-view 架构从"目录侧栏 + 正文"扩展为"书 A + 书 B"的**双书同屏阅读模式**。两个独立的阅读器实例并排显示，共享同步策略：

- **位置同步**：当书 A 翻到第 3 章时，书 B 自动跳到第 3 章（基于 TOC 索引对齐）
- **进度同步**：按百分比同步（书 A 读到 45%，书 B 跳到 45%）
- **手动独立**：解除同步，各自独立翻页
- **搜索联动**：在一侧搜索关键词，另一侧自动高亮相同关键词

典型场景：
- 原文 + 译本对照阅读
- 同一小说的正版 + 网络版对比
- 教材 + 参考书同步学习
- 校对场景：两个版本的文本逐段比对

### 为什么有创意

- 几乎所有阅读器都是"单书单窗口"，浏览器也确实只能打开一个页面，但 SimpleTextReader 是 SPA，可以在同一个 DOM 内渲染两套完整阅读界面
- 现有 `SidebarSplitView` 已经实现了可拖拽分隔条、宽度持久化、双面板布局 —— 离双书模式只差"在右侧面板再初始化一个 Reader 实例"
- 不需要多窗口、不需要浏览器扩展 —— 纯 SPA 内的创新
- 配合方向二的"阅读热力图"，可以对比两本书的阅读模式差异

### 代码切入点

| 切入点 | 位置 | 作用 |
|---|---|---|
| `SidebarSplitView` | `client/app/modules/components/sidebar-splitview.js` | 核心布局组件，已支持双面板 + 拖拽分隔条。可改造为接收"右侧面板内容初始化回调" |
| `reader-splitview.css` | `client/css/reader-splitview.css` | 已有 `.sidebar-splitview-container` 的 CSS Grid 布局，调整 `grid-template-columns` 即可变成 1fr + gap + 1fr |
| `reader` 模块 | `reader.js` | 需要可多实例化 —— 当前是单例模块（`export const reader`），需重构为类，允许多实例 |
| `FileHandler.handleMultipleFiles()` | `file-handler.js` L130+ | 入口：同时打开两个文件 → 分别处理 → 分别渲染到左右面板 |
| `CONFIG.VARS` 全局状态 | `config/variables.js` | 当前所有状态是全局单例（`FILE_CONTENT_CHUNKS`, `ALL_TITLES`, `PAGE_BREAKS` 等），需要支持"两套状态"，或给每个 reader 实例独立的 config scope |
| `cbReg` 事件命名空间 | `callback-registry.js` | 使用 `namespace` 参数区分"左侧 reader 事件"和"右侧 reader 事件"（如 `reader:left:progressChange` vs `reader:right:progressChange`） |
| `db-manager.js` / IndexedDB | `database/db-manager.js` | 两本书各自独立存储阅读进度，退出双书模式后各自保留独立进度 |
| TOC 索引对齐 | `reader.processTOC()` | 同步模式下，通过 `ALL_TITLES` 的索引位置做章节级对齐 |

### 实现路径

1. **重构 reader 为可实例化类**（最大工作量）：将 `export const reader = {...}` 改为 `export class Reader { constructor(namespace) {...} }`，每个实例使用独立的 namespace 向 `cbReg` 注册事件
2. **CONFIG 作用域隔离**：为每个 Reader 实例创建独立的 `VARS` 副本（`FILE_CONTENT_CHUNKS`, `ALL_TITLES`, `PAGE_BREAKS` 等），用 Proxy 或浅拷贝实现
3. **SplitView 适配**：将右侧面板的 `content-inner` 暴露为可注入的容器，第二个 Reader 实例渲染到其中
4. **同步控制器**：新增 `tandem-sync.js` 模块，监听两侧的 `reader:left:progressChange` 和 `reader:right:progressChange`，按用户选择的同步策略（章节/百分比/关闭）执行对侧跳转
5. **入口 UI**：书架界面新增"对比阅读"按钮（选中两本书后出现），或阅读界面工具栏新增"打开对照书"按钮

**工作量估算**：约 2-3 周（reader 多实例化重构 5 天 + SplitView 适配 2 天 + 同步控制器 2 天 + UI 入口 2 天 + 测试和边界情况 3 天）

---

## 方向五：情境阅读引擎 (Contextual Reading Engine) —— 一套代码，多种"读法"

### 核心创意

SimpleTextReader 已有"书本模式"和"日志模式"两种阅读模式（`LOG_MODE`），但这是按**文件类型**切换的。情境阅读引擎的思路是：**同一本书，在不同场景下用不同的"阅读姿态"来呈现**。

三种情境模式：

**A. 速读模式 (Speed Reading)**
- RSVP（Rapid Serial Visual Presentation）风格：每屏只显示一句话，居中放大，以可调速度（200-800 wpm）自动推进
- 利用 `FILE_CONTENT_CHUNKS` 逐句推进，跳过章节标题和空行
- 配合方向二的阅读热力图，智能跳过你已经反复读过的段落

**B. 精读模式 (Deep Reading)**
- 关闭无限滚动，强制分页
- 每页底部显示段落序号（"第 3/47 段"）
- 右侧留白区域变为"批注空间"（即使不做批注功能，留白本身也改变了阅读心理）
- 降低翻页灵敏度，需要明确的翻页意图才能翻页（防误触）
- 显示当前段落字数、预估阅读时间

**C. 睡前模式 (Bedtime Mode)**
- 色温随时间推移自动变暖（从 4000K 到 2000K），与系统日落时间联动或手动设置
- 字号比日间模式大 20%，行高更大
- 自动翻页速度极慢（"躺着手不碰设备"模式），或语音朗读接管
- 定时关闭（"读 20 分钟后自动停"），到达时间后先半透明淡出再关闭

### 为什么有创意

- 它不是加功能，而是改变**同一本书的呈现方式** —— 让阅读器像一个"有表情的舞台"，同一本书在速读、精读、睡前三种情境下给人完全不同的阅读体验
- 利用现有架构中的模式切换基础设施（log mode 已经证明模式切换是可行的），新增情境模式对渲染管线改动最小
- RSVP 速读在学术界有大量研究支撑（消除回扫、减少眼动），但在开源阅读器中几乎没有实现
- 色温渐变是 macOS Night Shift / f.lux 的思路，但"在阅读器内部独立实现而不依赖系统级色温"让它可以在任何平台上工作

### 代码切入点

| 切入点 | 位置 | 作用 |
|---|---|---|
| `LOG_MODE` 模式切换 | `constants.js` L86-88 | 已有模式切换范例，新增 `SPEED_MODE` / `DEEP_MODE` / `BEDTIME_MODE` 配置项 |
| `flowReader.enter()` / `exit()` | `flow-reader.js` L40-100 | 模式切换时调用，enter 负责渲染，exit 负责恢复。三种新模式各自实现 enter/exit |
| `reader` 模块翻页逻辑 | `reader.js` | RSVP 模式：新增 `autoAdvance(speed)` 定时器，从 `FILE_CONTENT_CHUNKS` 逐行取内容，渲染到居中全屏单句容器 |
| `TextProcessorCore.process()` | `text-processor-core.js` | RSVP 模式需要"按句分割"而非"按行分割"，可用 `REGEX_RULES.PUNCTUATION` 按句号/问号/感叹号断句 |
| CSS Variables 色温系统 | `variables.css` | 睡前模式：新增 `--color_temp` 变量（初始 4000K），用 `requestAnimationFrame` 逐步降低，CSS 中通过 `color-mix()` 或预计算的颜色阶梯表将色温映射到前景/背景色 |
| `cbReg.go("reader:progressChange")` | 已规划 Hook | 睡前模式定时器回调中监听，如果用户长时间无操作则触发淡出 |
| 设置面板 | `settings.js` + `createRangeItem` | 速读速度滑块、睡前色温起止值、定时关闭时长 |

### 实现路径

1. 在 `constants.js` 中新增三种模式常量，在 `settings.js` 中新增"阅读情境"选择器（`createSelectorItem`），选项为"标准/速读/精读/睡前"
2. 实现 RSVP 渲染器：`client/app/modules/features/speed-reader.js`，包含句子拆分（复用 `FILE_CONTENT_CHUNKS` 中的 charCount 字段）、居中渲染、自动推进定时器、暂停/恢复
3. 实现精读模式：修改 `reader.js` 的 `processPage()`，在页面底部注入段落计数和阅读时间，调整翻页灵敏度
4. 实现睡前模式：新增 `bedtime-controller.js`，管理色温渐变曲线（分段线性插值）、定时关闭逻辑、字号行高联动调整
5. 在 `flowReader` 和 `reader` 中增加模式感知：`enter()` 检查当前模式 → 分发到对应渲染器

**工作量估算**：约 2-3 周（RSVP 渲染器 3 天 + 精读模式 2 天 + 睡前模式色温系统 3 天 + 模式切换框架 2 天 + 设置面板和测试 3 天）

---

## 总结

| 方向 | 创意核心 | 技术难度 | 估算工期 | 对现有架构冲击 |
|---|---|---|---|---|
| 章节纹理 | 计算语言学 → 视觉签名 | 中 | 3-5 天 | 极小（只扩展 TOC 渲染） |
| 阅读热力图 | 行为数据可视化 + 幽灵回放 | 中 | 1-2 周 | 小（新增数据采集层） |
| 排版沙盒 | CSS 变量的极限运用 | 低 | 1 周 | 极小（纯 CSS + 设置项扩展） |
| 双书共读 | SPA 内多实例阅读器 | 高 | 2-3 周 | 大（reader 多实例化重构） |
| 情境阅读引擎 | 同一内容 × 三种呈现方式 | 中高 | 2-3 周 | 中（新增渲染器 + 模式分发） |

**推荐的推进顺序**（按投入产出比）：排版沙盒 → 章节纹理 → 阅读热力图 → 情境阅读引擎 → 双书共读。前三个方向改动小、效果强、独立性高，可并行或快速迭代验证。
