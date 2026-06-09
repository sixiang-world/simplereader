# Repository Guidelines

## Project Structure & Module Organization

SimpleTextReader is a browser-based TXT/EPUB reader with a vanilla JS client and a Node.js server.

- **`client/`** — Frontend (ES modules, no bundler).
  - `app/` — Core logic: `config/`, `modules/`, `utils/`, `lib/`, and the `app.js` entry point.
  - `css/` — Stylesheets; shared variables in `css/variables.css`.
  - `fonts/`, `images/`, `manifests/` — Static assets and platform manifests (Chrome, Firefox, PWA).
- **`server/`** — Node.js backend with Prisma ORM (`server/prisma/`).
- **`shared/`** — Code shared between client and server (adapters, config, core, utils).
- **`build-tools/`** — Python scripts for building extensions, subsetting fonts, and generating changelogs.

## Build, Test, and Development Commands

| Command | What it does |
|---|---|
| `python build-tools/build.py` | Build Chrome/Firefox extensions and Docker image; outputs to `dist/`. |
| `python build-tools/build.py -v <version>` | Build with an explicit version number. |
| `python build-tools/generate_changelog.py` | Generate `CHANGELOG.md` from git history. |
| `docker build -t simplereader .` | Build the production Docker image. |

The client requires no build step for local development. Open `client/index.html` or serve via the Node server.

## Coding Style & Naming Conventions

- **Modules**: ES modules (`"type": "module"`). Use `import`/`export`, not CommonJS.
- **Indentation**: 2 spaces (JS/CSS), 4 spaces (Python).
- **Naming**: `camelCase` for JS identifiers; `kebab-case` for CSS files. Match patterns already in the file you edit.
- **CSS**: Use variables from `css/variables.css`; keep library styles in `css/lib/`.
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
- **自动拼接 (Auto-Join)**: 布尔开关，启用后多页内容连续显示，无分页边界
- **显示行号 (Show Line Numbers)**: 布尔开关，启用后每行左侧显示行号

### 模式互斥关系

- 日志模式会自动启用自动拼接和行号显示
- 自动拼接与无限滚动（Infinite Scroll）互斥
- 日志模式下会隐藏侧边栏

## 项目约定

- `AGENTS.md` 与 `CLAUDE.md` 互为软链接
- 所有 git push / 文件修改 / 删除前需列变更清单确认
- 敏感操作前做 MD5 归档备份，不删源文件
