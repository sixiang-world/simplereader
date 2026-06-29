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
