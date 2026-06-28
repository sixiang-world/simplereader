# SimpleReader 单本书阅读体验 — 20 个开发方向

> 生成日期：2026-06-28
> 聚焦范围：打开一本本地小说后的阅读体验（不涉及统计总时长/排行榜/多设备同步/社交等）
> 每个方向均基于项目现有代码，标注精确切入点和分步实现路径

---

## 方向 1：仿真翻页动画

**痛点**：当前翻页是瞬间跳转，缺乏纸质书翻页的过渡感，长时间阅读缺乏仪式感。
**参考**：Readest 三维书页翻动、静读天下仿真翻书、Moon+ Reader 倾斜翻页。

**代码切入点**：
- `client/app/modules/features/reader.js` → `gotoPage()` 函数（约 L467-488），当前直接调用 `showCurrentPageContent()` + `window.scrollTo()`
- `client/app/modules/features/reader.js` → `gotoNextPage()` / `gotoPrevPage()`（约 L455-466），它们都委托给 `gotoPage()`
- `client/app/config/variables.js` → CONFIG.VARS 可新增动画配置项
- CSS：`client/app/styles/variables.css` 中已有 CSS 变量体系

**实现路径**：
1. 在 SETTINGS_SCHEMA（`settings.js` ~L90-350）中新增 select 设置项 `page_turn_animation`，选项：none / slide / fade / curl，持久化为 `CONFIG.CONST_CONFIG.PAGE_TURN_ANIMATION`
2. 在 `gotoPage()` 中，翻页前给 `CONTENT_CONTAINER` 添加 CSS class（如 `anim-slide-out-left`），用 `requestAnimationFrame` 在动画完成后执行实际内容替换
3. slide 模式用 `transform: translateX` + `opacity` 过渡；fade 模式只用 `opacity`；curl 模式用 CSS `clip-path` 模拟翻角
4. 动画时长约 200-300ms，通过 CSS 变量 `--page-turn-duration` 控制，可在设置中调整

---

## 方向 2：段间距与字间距微调

**痛点**：默认排版密度固定，不同读者对"疏朗"和"紧凑"的偏好差异巨大。静读天下以排版设置丰富著称，这是其核心竞争力。

**代码切入点**：
- `client/app/modules/features/settings.js` → SETTINGS_SCHEMA 的 `content-style` tab（约 L305+ 区域），已有 `body_font`、`title_font`、`font_size`、`line_height` 等设置项
- `client/app/config/constants.js` → `CONST_FONT`（约 L300-400），定义了字体相关常量
- CSS 变量体系：正文容器使用 CSS 变量控制排版参数，可直接新增 `--paragraph-spacing`、`--letter-spacing` 变量

**实现路径**：
1. 在 SETTINGS_SCHEMA 的 `content-style` tab 新增两个 range 类型设置项：
   - `paragraph_spacing`：段落间距（0-3em，步长 0.25，默认 1em），绑定到 `CONFIG.RUNTIME_VARS.STYLE.paragraphSpacing`
   - `letter_spacing`：字间距（0-5px，步长 0.5，默认 0），绑定到 `CONFIG.RUNTIME_VARS.STYLE.letterSpacing`
2. 利用已有的 `onApply` 回调或 CSS 变量注入机制，将值写入 content container 的 CSS 自定义属性
3. 正文 CSS 规则中使用 `p { margin-bottom: var(--paragraph-spacing); }` 和 `body { letter-spacing: var(--letter-spacing); }`
4. 按 SETTINGS_SCHEMA 的 `persist: true` 机制自动持久化

---

## 方向 3：文本对齐方式切换

**痛点**：网文中英文混排时，默认两端对齐会产生不均匀的词间距；纯中文阅读时左对齐反而更整齐。当前无此选项。

**代码切入点**：
- `client/app/modules/features/reader.js` → `showCurrentPageContent()` 渲染正文内容到 `CONTENT_CONTAINER`
- `client/app/config/variables.js` → CONFIG.RUNTIME_VARS.STYLE 可新增对齐字段
- CSS：正文容器目前未显式设置 `text-align`，浏览器默认行为

**实现路径**：
1. 在 SETTINGS_SCHEMA 的 `content-style` tab 新增 select 设置项 `text_align`，选项：justify（两端对齐）/ left（左对齐）/ start（默认），绑定到 `CONFIG.RUNTIME_VARS.STYLE.textAlign`
2. 通过 `onApply` 回调将值写入 content container 的 `style.textAlign` 或 CSS 自定义属性
3. 在 `showCurrentPageContent()` 渲染后应用该属性
4. 持久化到 localStorage（走 SETTINGS_SCHEMA persist 机制）

---

## 方向 4：阅读焦点行高亮

**痛点**：长段落中容易看串行，尤其在大屏上阅读密集文本时。物理书可以用手指跟踪，电子书缺乏这个辅助。

**代码切入点**：
- `client/app/modules/features/reader.js` → `showCurrentPageContent()` 渲染每行内容，行元素有 `id="line{N}"` 属性
- `client/app/utils/helpers-reader.js` → `GetScrollPositions()`（L113），实时计算当前屏幕顶行 `curLineNumber`
- `client/app/modules/features/reader.js` → `initReader()` 中的 scroll 事件处理（约 L985-1040）

**实现路径**：
1. 在 SETTINGS_SCHEMA 新增 checkbox 设置项 `focus_line_highlight`，绑定到 `CONFIG.CONST_CONFIG.FOCUS_LINE_HIGHLIGHT`
2. 在 `GetScrollPositions()` 中，当此项开启时，计算当前可视区域中间行的行号
3. 给该行元素添加 CSS class `focus-line`（半透明背景高亮），移除前一行的高亮
4. CSS 规则：`.focus-line { background: rgba(128,128,128,0.08); }`，在暗黑模式下使用不同透明度
5. 鼠标悬停时临时高亮悬停行（独立于自动高亮），参考 footnotes.js 的事件委托模式

---

## 方向 5：章节内微型进度条

**痛点**：底部全局进度条显示的是全书百分比，读者无法感知"本章还有多久读完"。尤其是章节很长时，缺乏章节级别的进度反馈。

**代码切入点**：
- `client/app/modules/features/reader.js` → `showCurrentPageContent()`（约 L105-180），渲染分页内容时已知 `PAGE_BREAKS` 和当前页的行范围
- `client/app/utils/helpers-reader.js` → `GetScrollPositions()`（L113-176），实时更新 `curLineNumber`，已经遍历 `ALL_TITLES` 判断当前章节
- `ALL_TITLES` 四元组结构 `[title, lineNum, shortTitle, isCustomOnly]`，可确定章节边界

**实现路径**：
1. 在 `GetScrollPositions()` 中，利用已有的 `for` 循环遍历 `ALL_TITLES` 判断当前章节（L138-152），新增计算：`chapterProgress = (curLineNumber - chapterStartLine) / (chapterEndLine - chapterStartLine) * 100`
2. 在阅读器顶部栏或内容区顶部插入一个微型进度条 DOM 元素（如 `#chapter-progress`，高 2px，彩色填充）
3. 每次 `GetScrollPositions()` 调用时更新该进度条的 `width` 百分比
4. 章节切换时（`setChapterTitleActive()` 被调用），重置进度条并更新章节名标签

---

## 方向 6：章末自动预加载下一页

**痛点**：翻页后偶尔出现短暂白屏（尤其是远程网络字体仍在加载时），打断阅读心流。flow-reader.js 已有 `preloadContent()` 机制，但分页模式未受益。

**代码切入点**：
- `client/app/modules/features/reader.js` → `showCurrentPageContent()` 每次只渲染当前页
- `client/app/modules/features/flow-reader.js` → `preloadContent()`（约 L200+），流模式下已有滑动窗口预加载逻辑
- `client/app/modules/features/reader.js` → `_initializePageScroll()` 的 `handleWheelEvent`（约 L780-850），可在滚轮事件中检测预加载时机

**实现路径**：
1. 在 `showCurrentPageContent()` 渲染完成后，如果当前页滚动位置 > 80%（即接近页底），触发异步预渲染
2. 创建隐藏的 DOM 容器 `#preload-container`，将 `PAGE_BREAKS[currentPage]` 到 `PAGE_BREAKS[currentPage+1]` 的内容渲染进去
3. 预渲染复用现有的行渲染逻辑（`_addLineToContainer` 等内部方法），但不插入可见 DOM
4. 翻页时如果预渲染容器已有内容，直接 swap 到 `CONTENT_CONTAINER`，跳过重新渲染
5. 预加载策略：仅预加载下一页（避免内存浪费），章节边界处跳过（不跨章预加载）

---

## 方向 7：一键切换阅读方向（横排/竖排）

**痛点**：日文轻小说、古典文学、港台繁体出版物习惯竖排阅读。目前项目仅支持横排。

**代码切入点**：
- CSS `writing-mode` 属性：`writing-mode: vertical-rl` 即可实现竖排
- `client/app/modules/features/reader.js` → `showCurrentPageContent()` 渲染的内容容器
- `client/app/modules/features/settings.js` → SETTINGS_SCHEMA 的 `content-style` tab
- 分页计算器 `shared/core/text/pagination-calculator.js` 中的 `PaginationCalculator` 类，可能需要适配竖排下的行列计算

**实现路径**：
1. 在 SETTINGS_SCHEMA 新增 select 设置项 `reading_direction`，选项：horizontal（横排）/ vertical-rl（竖排从右到左）/ vertical-lr（竖排从左到右）
2. 通过 `onApply` 回调直接设置 `CONTENT_CONTAINER.style.writingMode`
3. 竖排时同步调整：页码控件旋转 90 度、进度条改为垂直方向、双栏布局禁用
4. 高级：通知分页计算器调整 `linesPerPage` 计算（竖排时"行"变为"列"，字符数估算逻辑需适配）
5. 如果分页计算器适配复杂，可先降级为仅支持流模式的竖排（flow-reader 天然自适应 `writing-mode`）

---

## 方向 8：自动滚动阅读模式（Auto-Scroll）

**痛点**：单手操作时（地铁通勤、吃饭），持续翻页不方便。自动滚动解放双手。

**代码切入点**：
- `client/app/modules/features/reader.js` → `_initializePageScroll()`（L680-850），已有完整的 wheel 事件系统和 `isScrollPositionAtEdge()` 边缘检测
- `client/app/modules/features/flow-reader.js` → 流模式的滑动窗口渲染天然适合自动滚动
- `client/app/config/constants.js` → `CONST_CONFIG` 可新增自动滚动速度常量

**实现路径**：
1. 在 SETTINGS_SCHEMA 新增 checkbox 设置项 `auto_scroll` 和 range 设置项 `auto_scroll_speed`（50-500 像素/秒，默认 100）
2. 实现 `AutoScroller` 类：使用 `requestAnimationFrame` 循环，每帧按速度递增 `window.scrollY`
3. 鼠标移入内容区暂停滚动（`mouseenter` 事件），移出恢复
4. 滚轮手动干预时暂停自动滚动 3 秒后恢复（避免冲突）
5. 到达页底时自动触发 `gotoNextPage()` 并继续滚动
6. 在状态栏显示自动滚动指示器（如播放图标），点击可暂停/恢复

---

## 方向 9：段落级书签（精确到行）

**痛点**：当前项目通过 localStorage 记忆阅读进度（`helpers-reader.js` 的 `setHistory()`），但只记住一行号。读者无法标记多个"这里很好"的段落，下次打开只能回到最后位置。

**代码切入点**：
- `client/app/utils/helpers-reader.js` → `setHistory()`（L45-48），当前只存 `{filename}_history` = 行号
- `client/app/database/db-manager.js`（实际路径 `client/app/modules/database/db-manager.js`）→ IndexedDB 封装，支持多 object store
- `client/app/modules/features/reader.js` → `showCurrentPageContent()` 渲染的行元素 `id="line{N}"`
- `client/app/config/constants.js` → `CONST_DB` 定义了 DB 结构（3 个 object store）

**实现路径**：
1. 在 IndexedDB 中新增 object store `bookmarks`（keyPath: `id`, 字段: `filename`, `lineNumber`, `note`, `createdAt`），扩展 `CONST_DB.DB_STORES` 并升版 DB
2. 在内容区每行左侧添加书签图标（hover 时显示），点击添加/移除书签
3. 书签列表集成到 TOC 侧边栏（新增"书签"tab 或在目录顶部添加过滤切换）
4. 点击书签调用已有的 `reader.gotoLine(lineNumber)` 跳转
5. 所有书签操作通过 `DBManager` 实例执行，数据库升级通过 `db-manager.js` 的版本迁移机制

---

## 方向 10：书内引用跳转（"见第X章"一键直达）

**痛点**：小说中常有"详见第三章"、"如前所述"等内部引用，读者需要手动翻目录查找，打断阅读。

**代码切入点**：
- `shared/core/text/text-processor-core.js` → 文本预处理管线，在 `prepareContent()` 或类似流程中可插入新的文本处理步骤
- `shared/core/text/regex-rules.js` → `REGEX_RULES` 对象，已有 TITLES / FOOTNOTE / LANGUAGE 等正则规则，可新增引用模式
- `client/app/modules/features/reader.js` → `ALL_TITLES` 四元组结构和 `gotoChapterTitleLine()`（L755-768），可定位到目标章节

**实现路径**：
1. 在 `regex-rules.js` 中新增 `CROSS_REFERENCE` 正则规则，匹配中文引用模式：`第[一二三四五六七八九十百千\d]+章`、`见第[一二三四五六七八九十百千\d]+节`、`如前所述`（模糊提示）
2. 在 `text-processor-core.js` 的 `prepareContent()` 流程中插入后处理步骤：识别匹配片段，将其替换为 `<a class="cross-ref" data-target-chapter="N">原文</a>`
3. 在 `reader.js` 的 `showCurrentPageContent()` 中，对 `.cross-ref` 元素绑定点击事件委托
4. 点击时从 `ALL_TITLES` 中找到目标章节的 `lineNum`，调用 `reader.gotoChapterTitleLine(lineNum)` 跳转
5. 维护一个跳转历史栈（最多 20 条），支持"返回上一位置"（Backspace 键或 UI 按钮）

---

## 方向 11：词典/百科即点即查

**痛点**：遇到生词或典故需要切换应用查询，打断阅读。FBReader 集成 Google 翻译、Librera 提供上下文菜单查询，这是主流阅读器的标配。

**代码切入点**：
- `client/app/modules/features/search.js` → 已有搜索对话框的 DOM 创建和事件处理模式，可复用为查询浮层
- `client/app/modules/features/footnotes.js` → 脚注浮层的定位逻辑 `#positionDiv()`（含 EXCEED_RIGHT/EXCEED_BOTTOM 边界处理）和延迟隐藏机制（footnoteTimeout=1000ms），可直接复用
- `client/app/modules/features/reader.js` → `initReader()` 中的 scroll 事件处理（~L985），对 CONTENT_CONTAINER 的事件委托模式

**实现路径**：
1. 实现 `WordLookup` 模块（参考 footnotes.js 的单例模式）：
   - 监听 CONTENT_CONTAINER 上的 `dblclick` 事件，获取选中文本
   - 创建浮层 DOM（参考 search.js 的 `#searchDlg` 模式），显示查询结果
   - 浮层定位复用 footnotes.js 的 `#positionDiv()` 逻辑（屏幕边界检测 + 自动翻转）
2. 词典后端：调用免费词典 API（如 Free Dictionary API）或离线词库（预置常用中英词典 JSON）
3. 对中文词汇：调用百度百科/维基百科 API 获取摘要（需网络）
4. 浮层中包含"复制"/"搜索网页"快捷按钮
5. SETTINGS_SCHEMA 新增 checkbox 设置项 `enable_word_lookup` 控制开关

---

## 方向 12：沉浸式背景主题（渐变/纹理）

**痛点**：纯色背景（即使有暗黑模式）长时间阅读仍显单调。Readera 和 Moon+ Reader 提供纸张纹理背景，提升沉浸感。

**代码切入点**：
- `client/app/modules/features/settings.js` → SETTINGS_SCHEMA 已有 light_bgColor / dark_bgColor（L223-265），但只有纯色
- CSS 变量体系：content container 的背景色由 CSS 变量控制，可扩展为渐变或带纹理
- `client/app/config/constants.js` → `CONST_FONT` 定义了预设列表的模式（字体预设列表），可参考定义背景预设列表

**实现路径**：
1. 在 SETTINGS_SCHEMA 的 `theme` tab 中新增 select 设置项 `bg_texture`，选项：none / paper（米黄纸纹）/ aged（旧纸）/ parchment（羊皮纸）/ gradient_sunrise（晨曦渐变）/ gradient_night（夜空渐变）
2. 每种纹理用 CSS `background-image`（径向渐变 + 噪点 SVG 图案）实现，无需额外图片资源
3. 纹理叠加在纯色背景之上，保留原有的亮/暗模式配色，纹理只改变"质感"不改变基准色温
4. 通过 CSS class 切换（`data-bg-texture="paper"`），在 `settings.js` 的 `onApply` 回调中设置
5. 纹理 CSS 定义在独立的 stylesheet 中，按需注入（参考 `createStylesheet()` 在 `base.js` 中的模式）

---

## 方向 13：章节切换过渡提示（下一章预览）

**痛点**：读到章末时不知道下一章标题是什么，翻页后突然进入新章节缺乏心理准备。

**代码切入点**：
- `client/app/modules/features/reader.js` → `_getCurrentChapterIndex()`（L722-735），可获取当前章节索引
- `client/app/modules/features/reader.js` → `gotoNextChapter()` / `gotoPrevChapter()`（L695-718），章节导航已实现
- `ALL_TITLES` 包含所有章节的 `[title, lineNum, shortTitle, isCustomOnly]`
- `GetScrollPositions()`（helpers-reader.js L113）实时获取当前行号，可判断是否接近章末

**实现路径**：
1. 在 `GetScrollPositions()` 中，当 `curLineNumber` 距离下一章节起始行 < 1 页的行数时，判定为"接近章末"
2. 在页面底部淡入一个半透明提示条：`下一章：XXX`，附带一个小的右箭头图标
3. 提示条点击：调用 `reader.gotoNextChapter()`
4. 提示条在用户继续向下滚动或翻页后自动消失
5. 同理，在章首附近（第一页）向上滚动时显示"上一章：XXX"
6. CSS 动画：opacity 0 → 1 淡入，transition 300ms

---

## 方向 14：阅读位置导航历史（前进/后退）

**痛点**：误触跳转（点错目录、误按翻页键）后无法回到之前位置。与浏览器前进/后退按钮类似的心理模型。

**代码切入点**：
- `client/app/utils/helpers-reader.js` → `setHistory()`（L45），当前只存最后一次阅读位置
- `client/app/modules/features/reader.js` → `gotoLine()`（L601-650）、`gotoChapterTitleLine()`（L755-768）、`gotoPage()`（L467-488）——所有跳转操作的汇聚点
- `client/app/modules/features/reader.js` → `initReader()` 中 keyboard navigation（L1046-1120），可新增 Backspace/Alt+Left 快捷键

**实现路径**：
1. 实现 `NavigationHistory` 类（单例），维护两个栈：`backStack` 和 `forwardStack`，每项存储 `{filename, lineNumber, timestamp}`
2. 在 `gotoLine()` 和 `gotoChapterTitleLine()` 成功执行后，将旧位置 push 到 `backStack`，清空 `forwardStack`
3. 新增键盘快捷键：`Alt+Left` → 从 `backStack` pop 并在 `forwardStack` push，跳转到 pop 出的位置；`Alt+Right` → 反向操作
4. 在 UI 中添加小型前进/后退按钮（位于顶部栏或侧边栏底部），禁用状态灰色显示
5. 历史栈上限 50 条，超出时从底部移除最旧记录

---

## 方向 15：护眼色温调节（蓝光过滤）

**痛点**：夜间阅读即使使用暗黑模式，屏幕蓝光仍然影响褪黑素分泌。静读天下以"去除蓝光功能"著称。

**代码切入点**：
- `client/app/modules/features/settings.js` → SETTINGS_SCHEMA 的 theme tab，已有 dark/light 配色（L140-265 区域）
- CSS：可通过 `filter: sepia()` 或叠加半透明暖色层实现蓝光过滤
- `client/app/config/variables.js` → CONFIG.RUNTIME_VARS.STYLE 可新增色温字段

**实现路径**：
1. 在 SETTINGS_SCHEMA 的 `theme` tab 新增 range 设置项 `color_temperature`（范围 0-100，默认 0），0 = 无过滤，100 = 最强暖色
2. 实现方式 A（推荐）：在 `<body>` 上叠加一个固定定位的 `::after` 伪元素，背景色从 `rgba(255,200,100,0)` 渐变到 `rgba(255,180,80,0.4)`，`pointer-events: none`
3. 实现方式 B：使用 CSS `filter: sepia(value * 0.01 * 0.8)`，降低蓝光的同时保留一定色彩辨识度
4. 色温调节与亮/暗模式独立，两者叠加生效
5. 在 `settings.js` 的 `onApply` 回调中动态更新伪元素的背景透明度

---

## 方向 16：自定义键盘快捷键映射

**痛点**：当前快捷键硬编码在 `initReader()` 的 `navigationMap` 中（reader.js L1070-1120），ArrowLeft 固定为上一页、PageUp 为上一章。但不同阅读器用户的肌肉记忆不同（有人习惯 J/K 翻页，有人习惯空格翻页）。

**代码切入点**：
- `client/app/modules/features/reader.js` → `initReader()` 中的 `navigationMap` 对象（L1070-1120），当前硬编码了 7 个键映射
- `client/app/config/constants.js` → `SHORTCUTS` 对象（约 L483），当前仅是布尔开关（如 `arrow_left: true`），不是键名映射
- `client/app/modules/features/settings.js` → SETTINGS_SCHEMA 的 `general` tab

**实现路径**：
1. 第一步：重构 `SHORTCUTS` 为键名映射对象，如：
   ```js
   SHORTCUTS: {
     prevPage: "ArrowLeft",
     nextPage: "ArrowRight",
     prevChapter: "PageUp",
     nextChapter: "PageDown",
     search: "f",
     goToLine: "g",
     backToShelf: "Escape"
   }
   ```
2. 第二步：修改 `navigationMap` 从 `SHORTCUTS` 读取键名而不是判断布尔值，`e.key` 与映射值比较
3. 第三步：在 SETTINGS_SCHEMA 新增"快捷键"子 tab 或使用 PopupManager 打开快捷键配置弹窗
4. 快捷键录制 UI：点击某项 → 弹窗提示"按下新按键" → 捕获 `keydown` 事件 → 更新 `SHORTCUTS` 映射 → 持久化到 localStorage
5. 冲突检测：如果新按键已被其他操作占用，弹窗提示并让用户选择覆盖或取消

---

## 方向 17：章节字数统计与阅读时长预估

**痛点**：读者在选择"要不要现在读这章"时缺乏信息——不知道这章是 500 字还是 5000 字，也不知道预计要读多久。

**代码切入点**：
- `client/app/modules/features/reader.js` → `ALL_TITLES` 存储了所有章节的行号边界，可精确计算章节字数
- `shared/core/text/text-processor-core.js` → `FILE_CONTENT_CHUNKS` 是全文的行数组，结合 `ALL_TITLES` 的 `lineNum` 字段可切片统计字数
- `client/app/utils/helpers-reader.js` → `GetScrollPositions()` 实时更新当前章节位置

**实现路径**：
1. 在预处理阶段（`text-processor-core.js` 处理完成后），基于 `ALL_TITLES` 计算每个章节的字数（去除非正文字符），存储为 `CHAPTER_WORD_COUNTS` 数组
2. 在 TOC 侧边栏中，每个章节标题后显示字数（如"第三章 离别 ｜ 3,200字"），用灰色小字
3. 阅读时长预估：基于可配置阅读速度（SETTINGS_SCHEMA 新增 range `reading_speed`，100-800 字/分钟，默认 400），当前章节剩余字数 ÷ 速度 = 预估剩余分钟数
4. 在顶部状态栏或 TOC 中当前章节旁显示"剩余约 X 分钟"
5. 利用 `GetScrollPositions()` 中已有的 `curLineNumber` 和章节边界判断逻辑，无需额外计算开销

---

## 方向 18：专注阅读模式（全屏沉浸）

**痛点**：侧边栏 TOC、底部页码栏、顶部进度条等 UI 元素在长时间阅读时会分散注意力。Kindle 等设备通过全屏模式解决此问题。

**代码切入点**：
- `client/app/modules/features/reader.js` → `showCurrentPageContent()` 和 `generatePagination()`
- `client/app/modules/features/settings.js` → SETTINGS_SCHEMA 已有 checkbox 模式（参考 anonymous_mode / log_mode 的实现模式，L160-190）
- `client/app/app.js` → `setupReaderUISplitView()` 控制侧边栏分割视图

**实现路径**：
1. 在 SETTINGS_SCHEMA 新增 checkbox 设置项 `focus_mode`，绑定到 `CONFIG.CONST_CONFIG.FOCUS_MODE`
2. 开启时通过 CSS class `data-focus-mode="true"` 隐藏：
   - 侧边栏（`SidebarSplitView` collapse）
   - 底部页码栏（`#pagination-container`）
   - 顶部进度条（`#progress-bar`）
   - 所有 UI 控件（保留最小化状态）
3. 点击屏幕左/右边缘（边缘 30px 热区）临时唤出控件 3 秒后自动隐藏
4. 键盘 Esc 退出专注模式
5. 利用已有的 `cbReg` 回调系统触发 UI 模块的显示/隐藏（参考 `toggleInfiniteScroll` 的回调注册模式，reader.js ~L1010）

---

## 方向 19：阅读统计线标（章节热度/篇幅可视化）

**痛点**：打开一本书后，读者无法直观了解全书结构（哪些章节长、哪些章节短、高潮在哪里）。

**代码切入点**：
- `client/app/modules/features/reader.js` → `processTOC()` 后的 `ALL_TITLES` 数组（每个章节的起始行）
- `client/app/modules/features/reader.js` → `generatePagination()`（L180-430），页码控件的生成逻辑，可参考扩展
- `FILE_CONTENT_CHUNKS` 存储了全文所有行

**实现路径**：
1. 基于 `ALL_TITLES` 的行号间隔，计算每个章节的行数/字数（方向 17 已构建 `CHAPTER_WORD_COUNTS`）
2. 在进度条（`#progress-bar`，`<input type="range">` 元素）下方新增一个迷你柱状图（canvas 或 div 柱状条），每根柱子代表一个章节，高度反映章节篇幅
3. 当前所在章节的柱子高亮（active 色），已读章节用灰色，未读用浅灰
4. 鼠标悬停柱子上显示 tooltip：章节名称 + 字数
5. 点击柱子跳转到对应章节（调用已有的 `reader.gotoChapterTitleLine(lineNum)`）
6. 利用已有的 `progressBar` 事件处理（reader.js ~L1130-1150）作为事件委托基础

---

## 方向 20：阅读模式联动预设（日间/夜间/护眼一键切换）

**痛点**：当前亮/暗模式切换只改变背景和字体色，但读者在不同场景下还需要同步调整亮度、色温、字体大小等多项参数。需要一键切换预设方案。

**代码切入点**：
- `client/app/modules/features/settings.js` → SETTINGS_SCHEMA 中各项设置的 `onApply` 回调，每次单项修改只影响一个配置
- `client/app/config/variables.js` → CONFIG.RUNTIME_VARS.STYLE 包含所有可视样式变量
- `client/app/modules/features/settings.js` → `applyAllSettings()` 或类似批量应用函数

**实现路径**：
1. 定义 4 套预设方案的配置快照（JSON），每套包含：bgColor、fontColor、fontSize、lineHeight、colorTemperature、bgTexture 等 8-10 个关键参数：
   - 日间：浅色背景 + 黑色字体 + 16px + 1.8 行高
   - 夜间：深色背景 + 暖黄字体 + 16px + 1.8 行高 + 80% 色温
   - 护眼：米黄纸纹理 + 深棕字体 + 18px + 2.2 行高 + 60% 色温
   - 专注：纯黑背景 + 浅灰字体 + 14px + 2.5 行高 + 专注模式开启
2. 在 UI 中添加预设切换按钮组（顶部栏或侧边栏底部），4 个预设各一个图标按钮
3. 点击预设时，遍历快照中的所有 key，调用 `settings.apply(key, value)` 逐项应用（复用现有单设置项应用逻辑）
4. 用户修改任意单项后，"自定义"预设高亮，表示当前配置不属于任何预设
5. 预设快照存储在 `CONST_CONFIG.PRESET_SNAPSHOTS` 常量中，可扩展为用户自定义预设（存储到 localStorage）
