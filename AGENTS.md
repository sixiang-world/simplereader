# Repository Guidelines

> SimpleTextReader（易笺）— 基于 Vite 的浏览器端 TXT/EPUB 阅读器。当前版本 **v2.0.1**。
> 本文件是代码库的权威架构索引，由源码审查生成。`CLAUDE.md` 是指向本文件的软链接。

---

## 1. 项目结构

```
/
├── index.html              # Vite 入口（root = 仓库根）
├── vite.config.js          # Vite 配置 + 构建时预分页插件 + postbuild 拷贝
├── package.json            # scripts + devDependencies（vite/typescript/jschardet/jszip/opencc-js 等）
├── version.json            # 版本号 + 中英文 changelog（发版数据源）
├── help.json               # 帮助中心内容
├── jsconfig.json           # JSDoc 类型检查配置
├── Dockerfile              # node:20-alpine 构建 → caddy:2-alpine 静态服务
├── edgeone.json            # EdgeOne 部署配置（缓存头、构建命令）
├── client/                 # 前端源码（ES modules）
│   ├── src/                # 核心逻辑（见 §3 模块参考）
│   ├── lib/                # 第三方库（classic <script> 加载，见 §4.5）
│   ├── fonts/              # 字体文件（woff2）
│   ├── images/             # 静态图片
│   └── manifests/          # Chrome / Firefox / PWA manifest
├── shared/                 # 客户端与（历史）服务端共享的纯 JS（见 §3.6）
├── build-tools/            # Python 构建脚本 + 字体子集 + 预分页（见 §5）
├── test/                   # Node 原生 .mjs 测试套件（22 个文件，见 §6）
├── docs/                   # 架构文档（如 config-sync-fix-plan.md）
├── books/                  # 本地书籍库（构建时预分页为 dist/books/*.json）
├── archive/                # 归档代码（archive/server、archive/debug），不在主代码路径
└── workflows/              # CI 工作流（如存在）
```

### 1.1 关于 `server/`

v2 重构后服务端已归档至 `archive/server/`。当前镜像**仅含静态前端**，通过 Caddy（Docker）或 EdgeOne 部署 `dist/`。历史的服务端 API、Prisma ORM 不再使用。

---

## 2. 构建、测试与开发命令

| 命令 | 作用 |
|------|------|
| `pnpm install` | 安装依赖（Vite / TypeScript / jschardet / jszip / opencc-js / linkedom / xmldom） |
| `pnpm run dev` | 启动 Vite dev server（端口 3000，热更新） |
| `pnpm run build` | 生产构建 → `dist/`（含构建时预分页 books + postbuild 拷贝 lib/worker/shared） |
| `pnpm run preview` | 本地预览生产构建 |
| `pnpm run typecheck` | `tsc --noEmit -p jsconfig.json`（JSDoc 类型检查） |
| `pnpm run test` | 串联运行全部 22 个 `test/test-*.mjs`（Node 原生 assert，无测试框架） |
| `pnpm run preprocess-books` | 单独执行 `build-tools/preprocess-books.mjs` 预分页书籍 |
| `python build-tools/build.py` | 构建 Chrome/Firefox 扩展 + Docker 镜像，输出到 `dist/` |
| `python build-tools/build.py -v <version>` | 指定版本号构建 |
| `python build-tools/generate_changelog.py` | 从 git 历史生成 CHANGELOG.md |
| `docker build -t simplereader .` | 构建生产 Docker 镜像（Caddy 静态服务） |

> 注：环境无 pnpm 时可用 `npm install` + `npm run <script>` 替代（Dockerfile 即用 npm）。测试也可单独 `node test/test-xxx.mjs` 运行。

### 2.1 Vite 配置要点（`vite.config.js`）

- **root = 仓库根**，`base: "./"`，`publicDir: false`，`target: "es2022"`，`minify: "esbuild"`。
- **preprocessBooksPlugin**：`closeBundle` 钩子中扫描 `books/` 目录，对每个 .txt/.epub 跑 `FileProcessorCore` + `PaginationCalculator`，输出 `dist/books/*.json`（生产环境免后端分页）。
- **postbuild-copy-lib**：拷贝 `client/lib/`、`client/fonts/`、`client/images/`、`version.json`、`help.json`、Web Worker 及其依赖（`client/src/modules/database/`、`client/src/modules/file/`、`client/src/utils/helpers/worker.js`、`client/src/utils/base/`、`client/src/config/`、整个 `shared/`）到 `dist/`。Worker 内的动态 `import()` 不被 Vite 静态分析，必须显式拷贝。
- **jschardet 标记 external**：浏览器端通过 `client/lib/jschardet.min.js`（classic `<script>`，挂 `window.jschardet`）加载；npm 包仅用于 Node 测试/构建分支。

---

## 3. 模块参考

### 3.1 入口与初始化（`client/src/app.js`）

应用入口，IIFE 异步初始化流程：
1. `requestIdleCallbackPolyfill()` + 后台 fetch 版本数据 / 字体基线偏移
2. `requestIdleCallback` 内初始化核心 UI（标题、自定义光标、UI 模式、帮助按钮、SidebarSplitView）
3. `loadFontsInBackground()`
4. 顺序：`initReader()` → `initSettings()` → `registerT2SHook()`
5. 并行：`Promise.all([initBookshelf(), initFontpool()])`
6. 文件处理、URL 参数解析、历史导航等

> 配置同步已改为**手动模式**（见 §8），app.js 不再在 boot 时自动 pull/push。

### 3.2 配置层（`client/src/config/`）

| 文件 | 职责 |
|------|------|
| `index.js` | 聚合导出：`export * from constants/variables/variables-dom` |
| `constants.js` | `CONST_CONFIG`（功能开关及默认值：阅读模式、无限滚动、日志模式、行号、匿名模式、快捷键等）、`CONST_UI`（语言映射等）、`CONST_FONT`（字体配置） |
| `variables.js` | `AppVariables` 类实例化 `RUNTIME_VARS`（运行时状态：ALL_BOOKS_INFO、FILE_CONTENT_CHUNKS、ALL_TITLES、STYLE.* 等） |
| `variables-dom.js` | `DOM_ELEMENT`（关键 DOM 元素引用）、`RUNTIME_CONFIG`、`VARS`（初始化状态标志） |
| `icons.js` | SVG 图标定义 |
| `schema/settings-schema.js` | `SETTINGS_SCHEMA`（42 项设置定义）+ `MENU_SCHEMA`（标签页/分组布局），见 §9 |

`CONFIG` 顶层命名空间：`CONST_CONFIG`、`CONST_UI`、`CONST_FONT`、`RUNTIME_VARS`（含 `.VARS`、`.STYLE`、`.WEB_LANG`）、`RUNTIME_CONFIG`、`DOM_ELEMENT`。

### 3.3 核心基础设施（`client/src/core/`）

跨功能、非特性特定的基础设施模块。

| 文件 | 职责 |
|------|------|
| `hooks.js` | `HookRegistry` — 类型化、有序、async 感知的**值转换管道**。与 cbReg 不同：hooks 显式区分 transform（须返回值）与 intercept（可中止），管道遇 intercept 短路。保留钩子名：`file:beforeProcess`、`file:afterProcess`、`reader:beforeRender`、`reader:afterRender`。**T2S 已注册 `file:afterProcess`**。 |
| `config-sync.js` | 多设备配置同步（手动模式，见 §8） |
| `presets.js` | 排版预设系统：6 个内置预设（Default/Reading/Compact/Eye-care/Magazine/Code），localStorage `reader_presets` 存储，URL `?scheme=0/1/Name` 切换。API：`savePreset/loadPreset/deletePreset/applyPreset/resolvePresetFromURL` |
| `t2s.js` | 繁→简转换：`t2s_lite`（本地 JSON 映射表 ~2928 对）与 `t2s_pro`（OpenCC Wasm，懒加载）两模式互斥。注册 `file:afterProcess` hook，转换 bookData 的 metadata/processedLines/titles/footnotes |
| `t2s-opencc.js` | OpenCC 集成（`client/lib/opencc/full.js` 本地化，避免 CDN 被跟踪防护拦截） |
| `t2s-map.json` | 繁简映射表 |

### 3.4 功能模块（`client/src/modules/`）

| 子目录 | 关键文件 | 职责 |
|--------|----------|------|
| `reader/` | `reader.js`、`flow-reader.js`、`search.js`、`go-line.js`、`footnotes.js` | 阅读核心：分页渲染、目录(TOC)、翻页、流式/无限滚动、全文搜索(F)、跳转(G)、脚注 |
| `file/` | `file-handler.js`、`file-processor.js`、`file-processor-worker.js` | 文件处理：编码检测(jschardet)、TXT/EPUB 解析、分页计算（Worker 后台执行） |
| `epub/` | `epub-converter.js` | EPUB→TXT 结构转换（JSZip + DOMParser，OPF 清单 + XHTML 章节，**不用 epub.js**） |
| `bookshelf/` | `bookshelf.js` | 书架视图：浏览、分类、组织书籍 |
| `database/` | `db-manager.js`、`db-worker.js` | IndexedDB 抽象 + 后台 Worker（批量导入/查询不阻塞 UI） |
| `font/` | `fontpool.js` | 自定义字体管理（最多 3 个，拖入加载） |
| `settings/` | `settings.js`、`font-baseline.js` | 设置系统（见 §9）；`font-baseline.js` 处理字体基线偏移 |
| `text/` | `text-processor.js`、`text-processor-dom.js` | 文本解析：标题/作者/章节检测、广告过滤、脚注配对 |
| `init-webpage.js` | — | 网页初始化配置与渲染 |

### 3.5 组件（`client/src/components/`）

可复用 UI 组件：`cover-animation.js`（封面动画）、`cover-generator-canvas.js`/`-dom.js`（封面生成）、`custom-color-picker.js`（颜色选择器）、`dropdown-selector.js`（下拉）、`message-indicator.js`（消息提示）、`popup-manager.js`（弹窗/通知）、`sidebar-splitview.js`（可拖动分隔视图）。

### 3.6 共享层（`shared/`）

环境无关的纯 JS，客户端与历史服务端共用。

| 子目录 | 关键文件 | 职责 |
|--------|----------|------|
| `core/callback/` | `callback-registry.js` | `cbReg` — 通用 pub/sub 事件总线（async、优先级、once、命名空间、trace）。别名：`add`/`go`/`rm`/`once`/`ls`。**与 hooks.js 区分：cbReg 是通知（fire-and-forget），hooks 是值转换管道** |
| `core/file/` | `file-processor-core.js` | 文件处理基础逻辑（解析、校验、元数据） |
| `core/text/` | `text-processor-core.js`、`pagination-calculator.js`、`title-pattern-detector.js`、`bracket-processor.js`、`regex-rules.js` | 文本处理算法：分页计算、标题模式检测、括号平衡、正则规则 |
| `adapters/` | `jschardet.js`、`text-decoder.js` | 环境适配：jschardet（浏览器用 window.jschardet / Node 用 npm 包）、TextDecoder 统一接口 |
| `config/` | `shared-config.js` | 跨环境共享常量 |
| `utils/` | `logger.js` | 统一日志（debug/info/warn/error，含调用栈，按模块开关） |

### 3.7 工具层（`client/src/utils/`）

| 文件/目录 | 职责 |
|-----------|------|
| `base.js` + `base/` | 基础工具函数（`isVariableDefined`、`toBool`、`debounce`、`onReady`、`HSLToHex` 等，barrel 导出 `base/*.js`） |
| `helpers/settings.js` | 设置控件创建/取值：`setRangeValue`/`setColorValue`/`setSelectorValue`/`setCheckboxValue`/`createRangeItem`/`createColorItem`/`findFontIndex`/`isFontAvailable` |
| `helpers/worker.js` | `resolveWorkerUrl()` — Worker URL 解析（dev vs prod vs 扩展环境），`importDependencies()` |
| `helpers/reader.js` | 阅读器辅助（导航、进度、`setTitle`） |
| `helpers/ui.js` | UI 辅助（`initUIMode`、`setCustomCursor`、`showDropZone`、`updatePaginationCalculations` 等） |
| `helpers/bookshelf.js` | 书架排序/过滤 |
| `helpers/fonts.js` | 字体校验（TTF/OTF、中英文渲染） |
| `url-settings.js` | URL 参数覆盖设置（`?key=value`，不写 localStorage） |
| `label-refresh.js` | `refreshShareButtonLabels` |

### 3.8 浏览器扩展（`client/src/extension/`）

| 文件 | 职责 |
|------|------|
| `activate.js` | background script：拦截 .txt 文件打开、替换标签页为 index.html、消息处理（Chrome MV3 / Firefox MV2） |
| `contentScript.js` | 检测 `file://*.txt`、提取内容 Base64 编码、发送给 activate.js |

manifest 在 `client/manifests/{Chrome,Firefox,PWA}/manifest.json`。

---

## 4. 第三方库与样式

### 4.1 第三方库（`client/lib/`）

以 classic `<script>` 标签加载，挂 `window.*` 全局，**不经 Vite 打包**（保持全局变量契约）：

`jquery.min.js`(`$`/`jQuery`)、`tippy/`(`tippy`)、`jschardet.min.js`(`jschardet`)、`jszip.min.js`(`JSZip`)、`sweetalert2.js`(`Swal`)、`hyperlist.js`(`HyperList`)、`ipad-cursor.js`(`attachIpadCursor`)、`yaireo/`(`ColorPicker`/`position`)、`opencc/full.js`、`clamps.js`、`css-filter-gen.js`、`css-global-variables.js`。

### 4.2 样式文件（`client/src/styles/`）

| 文件 | 职责 |
|------|------|
| `variables.css` | **CSS 变量 + i18n 文本中心**（1367 行，四段式结构见 §10.3）；`@font-face` 字体定义 |
| `main.css` | 主样式 |
| `settings.css` | 设置面板专用样式 |
| `reader.css` / `flow-mode.css` / `reader-splitview.css` | 阅读器/流式模式/分隔视图 |
| `bookshelf.css` / `footnotes.css` / `buttons.css` | 书架/脚注/按钮 |
| `lib/` | 库样式（tippy 等） |

---

## 5. 构建工具（`build-tools/`）

| 文件 | 职责 |
|------|------|
| `build.py` | 构建 Chrome/Firefox 扩展 + Docker 镜像；`VersionManager` 管理 version.json/README 版本号 |
| `preprocess-books.mjs` | 预分页 books/ 下的书籍（Vite 插件调用） |
| `font_subset.py` / `font_names.py` / `splitfont_css2manifest.py` | 字体子集化、字体名提取、CSS→manifest 转换 |
| `generate_changelog.py` | 从 git 历史生成 CHANGELOG.md |
| `generate-t2s-map-from-opencc.mjs` | 从 OpenCC 生成 t2s-map.json |

---

## 6. 测试套件（`test/`）

**22 个测试文件**，Node 原生 `assert`（无框架），`pnpm run test` 串联运行。主要覆盖：

| 测试文件 | 覆盖 |
|----------|------|
| `test-config-sync.mjs` | config-sync 全部函数（pull/push/merge/token/ts/debounce/retry） |
| `test-settings-export.mjs` | settings 导出、手动同步入口、保护键、表单同步、令牌 UI 持久化、app.js 不自动同步 |
| `test-settings-schema.mjs` / `test-menu-schema-consistency.mjs` | Schema 字段、布局一致性 |
| `test-css-i18n-completeness.mjs` | variables.css i18n 四段式完整性（_zh/_en 配对、伪元素） |
| `test-hooks.mjs` | HookRegistry 管道 |
| `test-presets.mjs` / `test-presets-advanced.mjs` | 预设系统 |
| `test-t2s.mjs` / `test-t2s-advanced.mjs` / `test-opencc-cdn.mjs` | 繁简转换 |
| `test-mutual-exclusion.mjs` / `test-feature-conflicts.mjs` | 设置互斥（auto-join↔infinite-scroll、t2s_lite↔t2s_pro） |
| `test-url-settings.mjs` | URL 参数覆盖 |
| `test-worker-resolution.mjs` | Worker URL 解析 |
| `test-preprocess-books.mjs` | 预分页（EPUB DOMParser 兼容） |
| `test-text-processor-regex.mjs` | 文本处理正则 |
| `test-version-consistency.mjs` / `test-build-integration.mjs` | 版本号一致性、dist 构建产物 |
| `test-config-constants.mjs` / `test-base-submodules.mjs` / `test-issue-12.mjs` | 配置常量、基础工具、语言切换回归 |

> **重要**：`test-settings-export.mjs` 是**架构契约测试**，用源码静态检查（正则）验证关键架构约束（因 settings.js 依赖 DOM 无法直接 import）。修改同步/设置架构后须同步更新此测试。

---

## 7. Fork 与远端配置

本项目是 [henryxrl/SimpleTextReader](https://github.com/henryxrl/SimpleTextReader) 的 fork，面向 EPUB→TXT 结构转换增强。

| 远端名 | URL | 用途 |
|--------|-----|------|
| `origin` | `https://cnb.cool/shisheng820/simplereader.git` | CNB 代码托管（主仓库） |
| `github` | `https://github.com/sixiang-world/simplereader.git` | GitHub fork 镜像 |
| `upstream` | `https://github.com/henryxrl/SimpleTextReader.git` | 原版上游，用于同步更新 |

### 分支拓扑（2026-08-30 治理后）

| 分支（origin） | 指向 | 角色 |
|----------------|------|------|
| `main` | 最新 dev tip | 稳定发布线，随 dev ff-only 推进 |
| `dev` | 活跃开发 HEAD | 开发主线，含全部 v2 成果 |
| `archive/v2-design` | 851f2a8 | v2 设计探索归档，main 不含 |

**约定**：
- `main` 仅接受 `dev` 的 ff-only 合并，不直接接收 feature 提交
- 功能开发在 `dev` 上或从 `dev` 切 `feat/<name>` 短期分支，合并回 `dev`
- 已并入 `main` 的功能分支删除；仅保留 `archive/<name>` 作历史锚点（且其 HEAD 不等于 `main` HEAD，否则无意义）
- `feat/v2-features` 已删（drift 被 dev 的 d86cac7 升级覆盖，v2.0.0/v2.0.1 tag 由 dev 保留）
- `archive/feature/url-settings-override` 已删（指向 main HEAD，功能早并入）

---

## 8. 配置同步系统（手动模式）

`client/src/core/config-sync.js` 基于 textdb（`https://textdb.hunluan.space`）极简 KV 存储实现多设备配置同步。

### 8.1 同步模型：手动按需

**v2.0.1+ 重构后为手动模式**——不再有 boot 自动 pull、60s 周期轮询、saveSettings 自动 push、online 事件自动补推。pull/push 是用户通过设置面板"拉取"/"推送"按钮显式触发的独立请求动作。

```
用户点"拉取" → pullOnBoot() → applySyncPull(syncData) → mergeSyncedConfig → changedKeys → persistSyncedKeys + applySettings + syncValuesToForm
用户点"推送" → buildPushPayload(values) → pushConfig() → 成功/失败反馈
```

### 8.2 关键 API

| 函数/方法 | 位置 | 作用 |
|-----------|------|------|
| `pullOnBoot(opts)` | config-sync.js | 拉取远端配置，返回 v2 syncData 或 null |
| `pushConfig(payload, opts)` | config-sync.js | 推送 payload，3 次指数退避重试，返回 boolean |
| `mergeSyncedConfig(...)` | config-sync.js | 字段级 LWW 合并（按 ts），支持 protectedKeys/allowedKeys 过滤 |
| `buildPushPayload(values)` | config-sync.js | 构建 v2 格式 payload（带字段 ts） |
| `recordLocalChange(key)` | config-sync.js | 记录本地变更的时间戳 |
| `getSyncToken/setSyncToken/validateSyncToken` | config-sync.js | 令牌管理（ASCII 字母数字下划线，4-64 位，**禁用连字符 `-`**） |
| `settings.syncPull()` | settings.js | 手动拉取动作：pull → applySyncPull → 返回 {ok, changedKeys} |
| `settings.syncPush()` | settings.js | 手动推送动作：buildPushPayload → pushConfig → 返回 {ok} |
| `settings.applySyncPull(syncData)` | settings.js | 处理拉取返回：merge + persist + applySettings + **syncValuesToForm**（刷新表单） |
| `settings.syncValuesToForm(keys)` | settings.js | 把 values 回填到设置面板表单控件 |
| `settings.refreshSyncTokenUI()` | settings.js | 从 localStorage 重读令牌并重置 token 区 UI（丢弃未保存输入） |

### 8.3 数据格式（v2）

```json
{
  "_meta": { "v": 2, "pushedAt": 1722000000000 },
  "p_fontSize": { "v": "2em", "ts": 1722000001000 }
}
```
字段级 LWW：每个键带 `ts`，`ts` 大者胜。v1 旧数据（无 ts）自动迁移为 `ts:0`。

> 完整修复计划见 `docs/config-sync-fix-plan.md`。

---

## 9. 设置系统：Schema-UI 分离架构

### 9.1 三层架构

| 层级 | 文件 | 职责 |
|------|------|------|
| 数据 Schema | `config/schema/settings-schema.js` → `SETTINGS_SCHEMA` | 42 项设置的数据定义（key/type/tab/label/bind/default/persist 等） |
| 布局 Schema | 同文件 → `MENU_SCHEMA` | 6 个标签页（`content-style`/`theme`/`reader`/`general`/`shortcuts`/`about`）的分组与排序 |
| UI 渲染 | `modules/settings/settings.js` → `SettingsMenu` 类 | 按 Schema 渲染 DOM；`settings` 单例管理状态 |

### 9.2 SETTINGS_SCHEMA 字段

`key`、`type`（`checkbox`/`range`/`color`/`select`/`select-font`/`hidden`）、`tab`、`label`、`bind`（`CONFIG.*` 路径）、`default`、`persist` 为必填；可选：`hidden`、`note`、`options`/`optionLabels`、`min`/`max`/`step`/`unit`、`palette`、`mutualExclusiveWith`、`onApply`、`getValue`、`inputRef`。

### 9.3 虚拟项

非标准控件用 `__` 前缀虚拟项，在 `#createTabFromSchema()` 路由：
- `__config_share_url` → 分享配置 URL
- `__config_sync_token` → 同步令牌输入区（含拉取/推送按钮）

### 9.4 互斥对

- `continuous_scroll_mode` ↔ `infinite_scroll_mode`（自动拼接 ↔ 无限滚动）
- `t2s_lite` ↔ `t2s_pro`（繁简转换两模式）

### 9.5 settings 单例关键方法

`saveSettings`、`applySettings(colorOnly)`、`loadDefaultSettings`、`syncValuesToForm`、`refreshSyncTokenUI`、`syncPull`/`syncPush`/`applySyncPull`、`persistSyncedKeys`、`generateConfigURL`、`setLanguage`。`SettingsMenu` 类负责面板 show/hide（DOM 持久，非销毁重建）、事件监听、按 Schema 渲染。

---

## 10. 代码编写标准（Coding Standards）

> **警告**：这不是传统网页项目。配置驱动 + CSS 变量 i18n + Schema-UI 分离。修改功能前必须理解本节。

### 10.1 配置驱动原则

添加功能前先在配置层定义（`config/`），再让 UI 层消费。禁止在 UI 层硬编码用户可见文本。

### 10.2 cbReg vs hooks

- **cbReg**（`shared/core/callback/callback-registry.js`）：pub/sub 通知，fire-and-forget，模块间协调。
- **hooks**（`core/hooks.js`）：值转换管道，transform 须返回值，intercept 可中止管道。用于 `file:beforeProcess`/`file:afterProcess`/`reader:*`。

### 10.3 CSS 变量驱动的 i18n（四段式）

`variables.css`（1367 行）不使用 i18n 库，全部用户文本通过 CSS 自定义属性 + 伪元素实现。**四段式结构**：

```css
/* 段 1: :root 基础定义（约 14-645 行）—— 同时定义 _zh 和 _en 变体 */
:root {
  --ui_some_label: "";
  --ui_some_label_zh: "中文";
  --ui_some_label_en: "English";
}

/* 段 2: [data-lang="zh"] 中文覆盖（约 646-817 行） */
[data-lang="zh"] {
  --ui_some_label: var(--ui_some_label_zh);
}

/* 段 3: [data-lang="en"] 英文覆盖（约 818-1043 行） */
[data-lang="en"] {
  --ui_some_label: var(--ui_some_label_en);
}

/* 段 4: 伪元素渲染规则（约 1044-1367 行） */
#settingLabel-setting_some_key::before {
  content: var(--ui_some_label);
}
```

> **关键修正**：语言选择器是 `[data-lang="zh"]` / `[data-lang="en"]`（**不是** `[lang="zh"]`）。由 `CONFIG.RUNTIME_VARS.STYLE.ui_LANG` 驱动 HTML 元素的 `data-lang` 属性切换。

**命名约定**：`--ui_<label>`；`_zh`/`_en` 后缀必须同时定义；伪元素选择器 ID 格式 `#settingLabel-setting_<key>` 或 `#tooltip-setting_<key>`。遗漏任何一段 → 对应语言显示空白。

### 10.4 Worker 规范

- Worker 文件放 `client/src/modules/*/`，命名 `*-worker.js`（如 `file-processor-worker.js`、`db-worker.js`）。
- 用 `utils/helpers/worker.js` 的 `resolveWorkerUrl()` 解析 URL（dev/prod/扩展环境路径不同）。
- Worker 内的动态 `import()` 不被 Vite 静态分析，构建时由 `vite.config.js` 的 postbuild-copy 显式拷贝到 `dist/`。

### 10.5 第三方库加载

第三方库以 classic `<script>` 加载（挂 `window.*`），**不经 Vite 打包**。新增库时在 `index.html` 加 `<script>` 标签，并在 `vite.config.js` 的 postbuild-copy 中确保拷贝到 `dist/client/lib/`。

### 10.6 扩展环境差异

| 特性 | Web 应用 | 浏览器扩展 |
|------|----------|------------|
| Storage | `localStorage` | `chrome.storage.local` / `browser.storage.local` |
| 通信 | 直接调用 | `chrome.runtime.sendMessage` / `onMessage` |
| 文件 | File API | contentScript → activate.js → index.html |

> 注：当前 config-sync.js 直接用 `localStorage`，扩展环境兼容性待验证（见 fix-plan S 系列）。

---

## 11. 添加设置选项完整流程

以添加布尔开关 `my_feature` 为例：

1. **定义常量**：`config/constants.js` 的 `CONST_CONFIG` 加 `MY_FEATURE` + `MY_FEATURE_DEFAULT`。
2. **Schema 数据**：`settings-schema.js` 的 `SETTINGS_SCHEMA` 加条目（key/type/tab/label/bind/default/persist）。
3. **Schema 布局**：`MENU_SCHEMA` 对应 tab 的 `content[].items` 引用 key（或 `__` 虚拟项）。
4. **i18n 四段式**：`variables.css` 同时修改 `:root`（`_zh`+`_en`）、`[data-lang="zh"]`、`[data-lang="en"]`、伪元素 `::before` 四段。
5. **自定义 UI**（仅虚拟项）：`settings.js` 的 `#createTabFromSchema()` 加路由 + 私有方法。
6. **样式**（如需）：`settings.css`。
7. **测试**：`test/` 加 `test-*.mjs`。
8. **验证**：中英文切换文本正确；`pnpm run test` 全绿；`pnpm run typecheck` 无错。

> 标准控件（checkbox/range/color/select）Schema 定义后自动渲染，无需改 settings.js。

---

## 12. 阅读模式

### 排版模式
- **日志模式 (Log Mode)**：等宽字体、隐藏目录、不做文本过滤，适合 .log 文件
- **自动拼接 (Auto-Join)**：多页连续显示无分页边界（⚠ 实验功能，有已知 BUG）
- **显示行号 (Show Line Numbers)**：每行左侧显示行号

### 行为设置
- **无限滚动 (Infinite Scroll)**：顶部/底部继续滚动翻页
- **让无限滚动更容易触发**：降低阈值（1200→400）
- **匿名模式 (Anonymous Mode)**：打开的书不上书架

### 互斥关系
- 日志模式自动启用自动拼接 + 行号显示，隐藏侧边栏
- 自动拼接 ↔ 无限滚动 互斥

> 推荐「无限滚动」+「让无限滚动更容易触发」；「自动拼接」不推荐日常使用。

---

## 13. EPUB 转换技术要点

- **解析**：JSZip + DOMParser 解压解析（OPF 清单 + XHTML 章节），**不用 epub.js**
- **目标**：EPUB → TXT 纯文本结构，保留章节标题与段落
- **入口**：`modules/epub/epub-converter.js`
- **已知问题**：大型书籍分页计算需优化

---

## 14. 发布流程（Release Workflow）

1. **更新版本号**（3 文件）：
   - `version.json` — `"version"` 字段 + `changelog` 顶部新增条目（含 `date` 和中英文 `changes`）
   - `client/manifests/Chrome/manifest.json` — `"version"`
   - `client/manifests/Firefox/manifest.json` — `"version"`
2. **更新 CHANGELOG.md** — `[Unreleased]` 移入新版本段落，格式 `## [x.y.z] - YYYY-MM-DD`
3. **Commit** — Conventional Commits，如 `feat: vx.y.z — 描述`，Co-Authored-By 标注 Claude
4. **打 Tag** — `git tag vx.y.z`（指向含 manifest 更新的 commit）
5. **Push**（需用户确认）— `git push origin main && git push origin --tags` + `git push github main && git push github --tags`

> manifest 版本更新单独一个 commit，tag 指向该 commit。

---

## 15. Commit 与 PR 规范

- **Conventional Commits**：`feat:` / `fix(<scope>):` / `chore:` / `refactor(<scope>):`
- Feature 分支用 `feat/<name>` 模式
- PR 描述变更内容与原因，引用相关 issue，UI 变更附截图

---

## 16. 编码风格

- **模块**：ES modules（`"type": "module"`），`import`/`export`，非 CommonJS
- **缩进**：JS/CSS 2 空格，Python 4 空格
- **命名**：JS `camelCase`；CSS 文件 `kebab-case`
- **CSS**：用 `variables.css` 变量；库样式放 `styles/lib/`
- **无 linter/formatter**：遵循现有代码风格

---

## 17. 项目约定

- `AGENTS.md` 是真实文件，`CLAUDE.md` 是指向它的软链接
- 所有 git push / 文件修改 / 删除前列变更清单确认
- 敏感操作前做 MD5 归档备份，不删源文件
- README 中标注 `original by henryxrl` 以区分原作者上架版本

---

## 18. 常见错误与避免

1. **i18n 变量遗漏某段**：某语言下文本空白。严格按四段式（`:root` + `[data-lang="zh"]` + `[data-lang="en"]` + 伪元素）。
2. **Schema `bind` 路径错误**：值变更不生效。确认 `CONFIG.*` 路径存在。
3. **虚拟项未路由**：`__xxx` 在 `#createTabFromSchema()` 无对应 `if` 分支 → 显示空白。
4. **Node 测试 import DOM 模块**：`settings.js` 等依赖 DOM，测试用源码静态检查（正则）而非直接 import。
5. **互斥未双向配置**：A↔B 互斥须双方都配 `mutualExclusiveWith` + `onApply`。
6. **同步后 UI 不刷新**：pull 后须调 `applySettings()`（CSS 变量）**+ `syncValuesToForm()`**（表单控件），二者缺一不可。
7. **Worker 路径错误**：必须用 `resolveWorkerUrl()`，勿硬编码路径。
