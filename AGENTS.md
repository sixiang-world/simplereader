# Repository Guidelines

## Project Structure & Module Organization

SimpleTextReader is a browser-based TXT/EPUB reader with a vanilla JS client and a Node.js server.

- **`client/`** — Frontend (ES modules, Vite-powered).
  - `src/` — Core logic: `config/`, `core/`, `modules/`, `utils/`, `components/`, and `app.js`/`init-webpage.js` entry points.
  - `src/styles/` — Stylesheets; shared variables in `src/styles/variables.css`.
  - `lib/` — Third-party libraries (jQuery, tippy, jschardet, JSZip, etc.).
  - `fonts/`, `images/`, `manifests/` — Static assets and platform manifests (Chrome, Firefox, PWA).
- **`server/`** — Node.js backend with Prisma ORM (`server/prisma/`). (Archived to `archive/server/` as of v2 refactor.)
- **`shared/`** — Code shared between client and server (adapters, config, core, utils).
- **`build-tools/`** — Python scripts for building extensions, subsetting fonts, and generating changelogs.

## Build, Test, and Development Commands

| Command | What it does |
|---|---|
| `pnpm install` | Install Vite + TypeScript + jschardet (root package.json). |
| `pnpm run dev` | Start Vite dev server (default port 3000). Hot-reloads on save. |
| `pnpm run build` | Production build → `dist/`. Caddy should serve `dist/`. |
| `pnpm run preview` | Preview the production build locally. |
| `pnpm run typecheck` | Run `tsc --noEmit` for JSDoc-based type checking (jsconfig.json). |
| `pnpm run test` | Run the Node-native .mjs test suite (`test/test-*.mjs`). |
| `python build-tools/build.py` | Build Chrome/Firefox extensions and Docker image; outputs to `dist/`. |
| `python build-tools/build.py -v <version>` | Build with an explicit version number. |
| `python build-tools/generate_changelog.py` | Generate `CHANGELOG.md` from git history. |
| `docker build -t simplereader .` | Build the production Docker image. |

The client is now a Vite project (since v2 refactor). Previously it was pure static ES modules with no bundler — that mode is no longer supported. Open `index.html` via `npm run dev` for development, or deploy the `dist/` output from `npm run build` for production.

## Coding Style & Naming Conventions

- **Modules**: ES modules (`"type": "module"`). Use `import`/`export`, not CommonJS.
- **Indentation**: 2 spaces (JS/CSS), 4 spaces (Python).
- **Naming**: `camelCase` for JS identifiers; `kebab-case` for CSS files. Match patterns already in the file you edit.
- **CSS**: Use variables from `src/styles/variables.css`; keep library styles in `src/styles/lib/`.
- No linter or formatter is configured — follow existing code style by example.

## Testing Guidelines

No automated test suite exists. Verify changes manually by loading TXT and EPUB files in the browser and confirming reading, navigation, settings, and bookshelf behavior. For server changes, test API endpoints via Docker or direct `node` execution.

## Commit & Pull Request Guidelines

Commits follow **Conventional Commits**:

- `feat: <description>` — New features.
- `fix: <scope>: <description>` — Bug fixes (e.g., `fix(epub): ...`).
- `chore: <description>` — Tooling or non-functional changes.

Feature branches use the `feat/<name>` pattern. Pull requests should describe what changed and why, reference related issues, and include screenshots for UI changes.

## Architecture Overview

The client reads local TXT/EPUB files via the browser File API, detects encoding, parses structure (chapters, TOC), and renders a paginated or flow-mode reading experience. The server provides optional hosting, API endpoints, and database persistence via Prisma. `shared/` contains adapters and core logic reused on both sides.

## Fork & Remote Configuration

本项目是 [henryxrl/SimpleTextReader](https://github.com/henryxrl/SimpleTextReader) 的 fork，面向 EPUB→TXT 结构转换增强。

| 远端名 | URL | 用途 |
|--------|-----|------|
| `origin` | `https://cnb.cool/shisheng820/simplereader.git` | CNB 代码托管（主仓库） |
| `github` | `https://github.com/sixiang-world/simplereader.git` | GitHub fork 镜像 |
| `upstream` | `https://github.com/henryxrl/SimpleTextReader.git` | 原版上游，用于同步更新 |

## EPUB 转换技术要点

- **EPUB 解析**: 使用 JSZip + DOMParser 解压并解析 EPUB（OPF 清单 + XHTML 章节），**不使用** `epub.js` 库
- **转换目标**: EPUB → TXT 纯文本结构，保留章节标题和段落
- **已知问题**: 大型书籍需要分页计算优化（pagination calc for large books）
- **Fork 标注**: README 中标注 `original by henryxrl` 以区分原作者的上架版本

## 阅读模式说明

### 排版模式设置

- **日志模式 (Log Mode)**: 布尔开关，启用后使用等宽字体显示，隐藏目录，不做文本过滤。适合查看 `.log` 文件
- **自动拼接 (Auto-Join)**: 布尔开关，启用后多页内容连续显示，无分页边界（⚠ 实验功能，存在已知 BUG，不推荐日常使用）
- **显示行号 (Show Line Numbers)**: 布尔开关，启用后每行左侧显示行号

### 行为设置

- **无限滚动 (Infinite Scroll)**: 布尔开关，在页面顶部或底部继续滚动即可翻页
- **让无限滚动更容易触发 (Easier Infinite Scroll)**: 布尔开关，降低翻页阈值（1200 → 400），配合无限滚动使用翻页更丝滑
- **匿名模式 (Anonymous Mode)**: 布尔开关，开启后打开的书籍不会出现在书架上

### 推荐翻页设置

> **推荐使用「无限滚动」+「让无限滚动更容易触发」**，两功能配合翻页更丝滑。
> 「自动拼接」为实验功能，存在已知 BUG，不推荐日常使用。

### 模式互斥关系

- 日志模式会自动启用自动拼接和行号显示
- 自动拼接与无限滚动（Infinite Scroll）互斥
- 日志模式下会隐藏侧边栏

## 发布流程（Release Workflow）

每次发版需按以下顺序完成，不可遗漏：

1. **更新版本号** — 同时修改以下 3 个文件：
   - `version.json` — 更新 `"version"` 字段，并在 `changelog` 顶部新增对应版本条目（含 `date` 和中英文 `changes`）
   - `client/manifests/Chrome/manifest.json` — 更新 `"version"` 字段
   - `client/manifests/Firefox/manifest.json` — 更新 `"version"` 字段
2. **更新 CHANGELOG.md** — 将 `[Unreleased]` 内容移入新版本号段落，格式：`## [x.y.z] - YYYY-MM-DD`
3. **Commit** — 使用 Conventional Commits 格式，如 `feat: vx.y.z — 简要描述`，Co-Authored-By 标注 Claude
4. **打 Git Tag** — `git tag vx.y.z`（指向最新 commit，包含 manifest 更新）
5. **Push**（需用户确认后执行）— `git push origin main && git push origin --tags` 以及 `git push github main && git push github --tags`

> 注意：manifest 版本更新单独一个 commit，tag 指向该 commit。

## 项目约定

- `AGENTS.md` 与 `CLAUDE.md` 互为软链接
- 所有 git push / 文件修改 / 删除前需列变更清单确认
- 敏感操作前做 MD5 归档备份，不删源文件

---

# 代码编写标准（Coding Standards）

> **警告**：本仓库不是传统的 HTML/CSS/JS 网页项目。它是一个基于 Vite 构建的复杂前端应用，拥有严格的配置驱动架构、CSS 变量驱动的 i18n 系统、以及 Schema-UI 分离的设置面板。在修改任何功能前，必须完整阅读并理解本节内容。**不要像写传统网页那样直接修改 HTML 或硬编码文本。**

## 1. 核心架构原则

### 1.1 配置驱动（Config-Driven）

本项目的几乎所有行为都由配置文件驱动，而非硬编码：

- **`client/src/config/`** — 运行时配置、常量、图标、变量定义
- **`client/src/config/schema/settings-schema.js`** — 设置面板的 Schema 定义（数据层）
- **`client/src/config/variables.js`** / **`variables-dom.js`** — 运行时变量
- **`client/src/styles/variables.css`** — CSS 变量，同时也是 i18n 文本的存储位置

**原则**：添加任何新功能前，先在配置层定义，再让 UI 层消费配置。

### 1.2 Schema-UI 分离

设置面板采用严格的 Schema-UI 分离架构：

| 层级 | 文件 | 职责 |
|------|------|------|
| 数据 Schema | `client/src/config/schema/settings-schema.js` | 定义设置项的数据结构、类型、默认值、绑定路径 |
| 布局 Schema | `client/src/config/schema/settings-schema.js` (MENU_SCHEMA) | 定义设置项在面板中的分组、排序、标签页归属 |
| UI 渲染 | `client/src/modules/settings/settings.js` | 根据 Schema 渲染实际的 DOM 元素 |
| UI 辅助函数 | `client/src/utils/helpers/settings.js` | 创建具体的表单控件（checkbox、range、color 等） |
| 样式 | `client/src/styles/settings.css` | 设置面板专用样式 |
| i18n 文本 | `client/src/styles/variables.css` | 所有用户可见文本通过 CSS 变量实现多语言 |

**禁止**：在 UI 渲染层硬编码用户可见的文本字符串。

### 1.3 CSS 变量驱动的 i18n 系统

本项目不使用传统的 i18n 库（如 i18next）。所有用户界面文本都通过 CSS 自定义属性（CSS Variables）实现多语言切换。

**三阶段架构**：

```css
/* === 阶段 1: 基础定义（默认中文）=== */
:root {
  --ui_some_label: "";
  --ui_some_label_zh: "中文文本";
  --ui_some_label_en: "English Text";
}

/* === 阶段 2: 中文覆盖 === */
[lang="zh"] {
  --ui_some_label: var(--ui_some_label_zh);
  /* ... 所有中文文本变量 ... */
}

/* === 阶段 3: 英文覆盖 === */
[lang="en"] {
  --ui_some_label: var(--ui_some_label_en);
  /* ... 所有英文文本变量 ... */
}

/* === 阶段 4: 通过伪元素渲染 === */
#settingLabel-setting_some_key::before {
  content: var(--ui_some_label);
}
```

**关键点**：
- 基础 `:root` 中同时定义 `*_zh` 和 `*_en` 两个变体
- `[lang="zh"]` 和 `[lang="en"]` 选择器分别覆盖实际使用的变量
- 文本通过 `content: var(--ui_*)` 伪元素注入到 DOM
- HTML 根元素的 `lang` 属性切换即可实现语言切换（由 `CONFIG.RUNTIME_VARS.STYLE.ui_LANG` 控制）

---

## 2. 添加设置选项的完整流程（以 Checkbox 为例）

> **这是本标准的核心内容。之前多次出现遗漏步骤导致的 Bug，必须严格遵守以下流程。**

假设要添加一个名为 `my_feature` 的布尔开关设置项：

### 步骤 1：在 `client/src/config/index.js` 或相关配置文件中定义常量

如果该设置需要常量定义（如默认值），先在配置层添加：

```js
// client/src/config/index.js（或 appropriate config file）
export const CONST_CONFIG = {
  // ... 现有常量 ...
  MY_FEATURE: false,           // 运行时值
  MY_FEATURE_DEFAULT: false,   // 默认值
};
```

### 步骤 2：在 `settings-schema.js` 的 `SETTINGS_SCHEMA` 中添加数据定义

```js
// client/src/config/schema/settings-schema.js
const SETTINGS_SCHEMA = [
  // ... 现有设置项 ...
  {
    key: "my_feature",           // 唯一标识符，用于 localStorage 键名
    type: "checkbox",            // UI 控件类型：checkbox | range | color | select | select-font | hidden
    tab: "general",              // 所属标签页：general | theme | content-style | reader | shortcuts
    label: "setting_my_feature", // 对应 CSS 变量前缀（见步骤 4）
    note: true,                  // 是否显示 ⓘ 提示图标（可选）
    bind: "CONFIG.CONST_CONFIG.MY_FEATURE",  // 绑定的运行时变量路径
    default: CONFIG.CONST_CONFIG.MY_FEATURE_DEFAULT,
    persist: true,               // 是否持久化到 localStorage
    // mutualExclusiveWith: "other_feature",  // 互斥设置项的 key（可选）
    // onApply: function(value) { ... },      // 应用时的副作用回调（可选）
  },
];
```

**Schema 字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `key` | string | ✅ | 唯一标识符，用于 localStorage 和代码引用 |
| `type` | string | ✅ | 控件类型：`checkbox`、`range`、`color`、`select`、`select-font`、`hidden` |
| `tab` | string | ✅ | 所属标签页 ID |
| `label` | string | ✅ | CSS 变量名前缀（格式：`setting_<key>`） |
| `bind` | string/string[] | ✅ | 绑定的 `CONFIG.RUNTIME_VARS` 路径 |
| `default` | any | ✅ | 默认值 |
| `persist` | boolean | ✅ | 是否保存到 localStorage |
| `hidden` | boolean | ❌ | 为 `true` 时不在 UI 显示（但 schemaMap 仍有条目） |
| `note` | boolean | ❌ | 为 `true` 时显示 ⓘ 提示图标 |
| `options` | string[] | ❌ | `select` 类型的选项值数组 |
| `optionLabels` | string[] | ❌ | `select` 类型的选项显示文本数组 |
| `min`/`max`/`step`/`unit` | number/string | ❌ | `range` 类型的范围配置 |
| `palette` | string[] | ❌ | `color` 类型的预设色板 |
| `mutualExclusiveWith` | string | ❌ | 互斥设置项的 key |
| `onApply` | Function | ❌ | 值变更后的副作用回调，`this` 指向 settings 实例 |
| `getValue` | Function | ❌ | 自定义取值函数（用于派生值） |
| `inputRef` | string | ❌ | 引用另一个设置项的 input 元素（用于派生值） |

### 步骤 3：在 `settings-schema.js` 的 `MENU_SCHEMA` 中定义布局位置

```js
const MENU_SCHEMA = [
  // ... 现有标签页定义 ...
  {
    id: "general",
    order: 5,
    content: [
      // ... 现有分组 ...
      {
        section: "setting_separator_my_section",  // 分组标题（对应 CSS 变量）
        order: 7,                                 // 分组排序（越小越靠前）
        items: ["my_feature", "another_feature"], // 该分组包含的设置项 key
      },
    ],
  },
];
```

**虚拟项（Virtual Items）**：

如果设置项需要自定义 UI（不是标准 checkbox/range/color/select），使用以 `__` 前缀的虚拟项：

```js
// MENU_SCHEMA 中引用虚拟项
{
  section: "setting_separator_sync",
  order: 5,
  items: ["__config_sync_token"],  // 以 __ 开头，不是 SETTINGS_SCHEMA 的 key
}
```

然后在 `settings.js` 的 `#createTabFromSchema()` 中添加虚拟项处理：

```js
// client/src/modules/settings/settings.js
if (itemId === "__config_sync_token") {
  tab.appendChild(this.#createSyncTokenItem());
  continue;
}
```

并在同一文件中添加私有方法 `#createSyncTokenItem()` 来渲染自定义 UI。

### 步骤 4：在 `variables.css` 中添加 i18n 文本定义

**这是最容易遗漏的步骤，也是之前多次出错的地方。**

`variables.css` 采用严格的三段式结构。新增文本必须同时修改三个位置：

```css
/* === 位置 1: :root 基础定义（约第 1-700 行区域）=== */
:root {
  /* 添加基础变量定义（默认值留空） */
  --ui_my_feature: "";
  --ui_my_feature_zh: "我的功能";
  --ui_my_feature_en: "My Feature";

  /* 如果有 note（ⓘ 提示），还需定义 _note 后缀 */
  --ui_my_feature_note: "";
  --ui_my_feature_note_zh: "这是功能的提示说明";
  --ui_my_feature_note_en: "This is a tooltip description";

  /* 如果是分组标题，定义 separator */
  --ui_separator_my_section: "";
  --ui_separator_my_section_zh: "我的分组";
  --ui_separator_my_section_en: "My Section";
}

/* === 位置 2: [lang="zh"] 中文覆盖块（约第 700-930 行）=== */
[lang="zh"] {
  /* ... 现有变量 ... */
  --ui_my_feature: var(--ui_my_feature_zh);
  --ui_my_feature_note: var(--ui_my_feature_note_zh);
  --ui_separator_my_section: var(--ui_separator_my_section_zh);
}

/* === 位置 3: [lang="en"] 英文覆盖块（约第 930-990 行）=== */
[lang="en"] {
  /* ... 现有变量 ... */
  --ui_my_feature: var(--ui_my_feature_en);
  --ui_my_feature_note: var(--ui_my_feature_note_en);
  --ui_separator_my_section: var(--ui_separator_my_section_en);
}

/* === 位置 4: 伪元素渲染规则（约第 990-1280+ 行）=== */
/* 设置项标签 */
#settingLabel-setting_my_feature::before {
  content: var(--ui_my_feature);
}

/* 提示文本（如果有 note: true） */
#tooltip-setting_my_feature::before {
  content: var(--ui_my_feature_note);
}

/* 分组标题 */
#settingLabel-setting_separator_my_section::before {
  content: var(--ui_separator_my_section);
}
```

**关键规则**：
- 所有变量名必须遵循 `--ui_<label>` 的命名约定
- `_zh` 和 `_en` 后缀必须同时定义，缺一不可
- `[lang="zh"]` 和 `[lang="en"]` 块中必须同时添加映射
- 伪元素规则中的选择器 ID 格式为 `#settingLabel-setting_<key>` 或 `#tooltip-setting_<key>`
- 如果遗漏任何一段，对应语言下将显示空白文本

### 步骤 5：在 `settings.css` 中添加自定义样式（如果需要）

如果设置项需要特殊的 CSS 样式（如自定义布局、动画等），在 `client/src/styles/settings.css` 中添加：

```css
/* 示例：自定义同步令牌输入框样式 */
.sync-token-wrapper {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.5rem 0;
}

.sync-token-input-row {
  display: flex;
  gap: 0.5rem;
}
```

### 步骤 6：在 `settings.js` 中添加虚拟项渲染逻辑（如果需要自定义 UI）

如果设置项使用标准控件（checkbox、range、color、select），Schema 定义完成后 UI 会自动渲染，**无需修改 `settings.js`**。

只有需要自定义 UI 时才添加虚拟项处理：

```js
// client/src/modules/settings/settings.js

// 1. 在 #createTabFromSchema() 的虚拟项分发区域添加路由
if (itemId === "__config_sync_token") {
  tab.appendChild(this.#createSyncTokenItem());
  continue;
}

// 2. 添加私有方法渲染自定义 UI
#createSyncTokenItem() {
  const wrapper = document.createElement("div");
  wrapper.className = "sync-token-wrapper";
  // ... 构建自定义 DOM ...
  return wrapper;
}
```

### 步骤 7：添加测试

在 `test/` 目录下添加对应的测试文件：

```js
// test/test-my-feature.mjs
import { strict as assert } from "node:assert";

// 测试 Schema 定义
// 测试配置常量
// 测试业务逻辑
// 测试边界条件
```

### 步骤 8：验证清单

修改完成后，逐项检查：

- [ ] `SETTINGS_SCHEMA` 中已添加条目，且 `key` 唯一
- [ ] `MENU_SCHEMA` 中已引用该设置项（或虚拟项）
- [ ] `bind` 字段指向的 `CONFIG` 路径存在且正确
- [ ] `variables.css` 的 `:root` 中定义了 `_zh` 和 `_en` 变体
- [ ] `variables.css` 的 `[lang="zh"]` 块中映射了该变量
- [ ] `variables.css` 的 `[lang="en"]` 块中映射了该变量
- [ ] `variables.css` 的伪元素规则中添加了 `::before { content: ... }`
- [ ] 如果是虚拟项，`settings.js` 中添加了路由和渲染方法
- [ ] 如果添加了自定义样式，`settings.css` 中已定义
- [ ] 测试文件已添加并通过
- [ ] 在浏览器中验证中英文切换时文本正确显示

---

## 3. 其他关键架构规范

### 3.1 Hook 系统（`client/src/core/hooks.js`）

Hook 系统用于**值转换管道**，与 cbReg 事件总线不同：

- **cbReg**：发布/订阅模式，用于模块间通知（fire-and-forget）
- **HookRegistry**：转换管道，每个 hook 可以修改值并传递给下一个

使用场景：
- 文件处理前的预处理（`file:beforeProcess`）
- 渲染前的内容转换（`reader:beforeRender`）
- 任何需要"链式修改值"的场景

### 3.2 配置同步系统（`client/src/core/config-sync.js`）

配置同步通过 textdb.hunluan.space 实现多设备同步：

- 使用 localStorage 存储同步令牌
- 令牌验证规则：ASCII 字母、数字、下划线，长度 4-64
- **禁止在令牌中使用连字符 `-`**（textdb API 会返回 400）
- 推送采用防抖（debounce）机制，默认 2 秒
- 合并策略：sync 数据覆盖本地（last-write-wins）

### 3.3 扩展环境差异

代码可能在两种环境中运行：

| 特性 | Web 应用 | 浏览器扩展 |
|------|----------|------------|
| Storage | `localStorage` | `chrome.storage.local` / `browser.storage.local` |
| 通信 | 直接调用 | `chrome.runtime.sendMessage` / `onMessage` |
| 文件访问 | File API | 可能通过 background script |

**规范**：使用配置抽象层访问存储，不要直接调用 `localStorage` 或 `chrome.storage`。

### 3.4 Worker 使用规范

- Worker 文件放在 `client/src/modules/*/` 目录下，以 `*-worker.js` 命名
- 使用 `client/src/utils/helpers/worker.js` 中的 `resolveWorkerUrl()` 解析 Worker URL
- 开发环境（Vite dev server）和生产环境（`dist/`）的 Worker 路径不同，必须通过辅助函数解析

### 3.5 字体系统

- 字体定义在 `client/src/styles/variables.css` 的 `@font-face` 规则中
- 字体可用性检测通过 `client/src/utils/helpers/settings.js` 的 `isFontAvailable()` 实现
- 自定义字体通过 `cbReg.go("addCustomFont", ...)` 添加

---

## 4. 常见错误与避免方法

### 错误 1：遗漏 CSS i18n 变量的某一段

**症状**：设置面板中某文本在中文/英文模式下显示空白。

**原因**：只添加了 `:root` 定义，但遗漏了 `[lang="zh"]` 或 `[lang="en"]` 映射，或遗漏了伪元素 `content` 规则。

**避免**：严格按照步骤 4 的四段式结构添加，使用验证清单逐项检查。

### 错误 2：Schema 中 `bind` 路径错误

**症状**：设置值变更后没有生效，或影响到错误的变量。

**原因**：`bind` 字段指向的 `CONFIG` 路径拼写错误，或该路径不存在。

**避免**：在 `client/src/config/index.js` 中确认路径存在，使用点号连接的路径格式（如 `"CONFIG.RUNTIME_VARS.STYLE.someVar"`）。

### 错误 3：虚拟项未在 `settings.js` 中添加路由

**症状**：设置面板中虚拟项位置显示空白，或抛出 `undefined` 错误。

**原因**：`MENU_SCHEMA` 中添加了 `__xxx` 虚拟项，但 `settings.js` 的 `#createTabFromSchema()` 中没有对应的路由处理。

**避免**：每个 `__` 前缀的虚拟项都必须在 `settings.js` 中有对应的 `if (itemId === "__xxx")` 分支。

### 错误 4：在 Node.js 测试环境中直接导入 DOM 依赖模块

**症状**：测试运行时报 `window is not defined` 或 `document is not defined`。

**原因**：`settings-schema.js` 等文件依赖 `window`/`document`，不能在 Node.js 测试中直接 `import`。

**避免**：使用源码提取 + 沙箱求值模式，或将被测逻辑提取到纯函数模块中。

### 错误 5：互斥设置项未正确配置

**症状**：两个互斥的 checkbox 可以同时勾选。

**原因**：只在一个设置项上配置了 `mutualExclusiveWith`，另一个没有配置；或 `mutualExclusiveWith` 指向的 key 不存在。

**避免**：互斥关系必须双向配置（A 的 `mutualExclusiveWith` 指向 B，B 的 `mutualExclusiveWith` 指向 A），且双方都必须有 `onApply` 回调来取消对方。

---

## 5. 代码审查清单（Code Review Checklist）

在提交 PR 前，审查人应检查：

### 功能正确性
- [ ] 新功能在 Schema、UI、i18n、样式四个层面完整实现
- [ ] 设置值变更后正确持久化到 localStorage
- [ ] 设置值变更后正确应用到运行时状态
- [ ] 页面刷新后设置值正确恢复

### i18n 完整性
- [ ] 所有新增用户可见文本都有 `_zh` 和 `_en` 定义
- [ ] 中文模式下文本显示正确
- [ ] 英文模式下文本显示正确
- [ ] 切换语言时文本实时更新

### 兼容性
- [ ] 代码在 Web 应用和浏览器扩展环境都能运行
- [ ] 不破坏现有设置项的功能
- [ ] 不破坏现有主题的显示

### 测试
- [ ] 新增功能有对应的单元测试
- [ ] 所有现有测试仍然通过 (`pnpm run test`)
- [ ] TypeScript 类型检查通过 (`pnpm run typecheck`)

### 性能
- [ ] 没有不必要的 DOM 操作或重绘
- [ ] 没有内存泄漏（事件监听器正确清理）

---

## 6. 文件修改权限矩阵

| 文件/目录 | 修改场景 | 注意事项 |
|-----------|----------|----------|
| `client/src/config/schema/settings-schema.js` | 添加/修改设置项 | 必须同步修改 MENU_SCHEMA |
| `client/src/styles/variables.css` | 添加 i18n 文本 | 必须同时修改 :root、[lang="zh"]、[lang="en"]、伪元素规则四段 |
| `client/src/modules/settings/settings.js` | 自定义 UI 控件 | 优先使用 Schema 自动渲染，不得已才加虚拟项 |
| `client/src/styles/settings.css` | 设置面板样式 | 保持与现有样式命名一致 |
| `client/src/config/index.js` | 添加配置常量 | 同步更新默认值常量 |
| `test/*.mjs` | 添加测试 | 避免直接 import DOM 依赖模块 |

---

## 7. 扩展阅读

- **Hook 系统**：`client/src/core/hooks.js` — 详细文档和示例
- **配置同步**：`client/src/core/config-sync.js` — API 契约和失败处理
- **预设系统**：`client/src/core/presets.js` — 主题预设和 URL 参数解析
- **回调注册表**：`shared/core/callback/callback-registry.js` — 模块间通信机制
- **T2S 转换**：`client/src/core/t2s.js` / `t2s-opencc.js` — 繁简转换实现
