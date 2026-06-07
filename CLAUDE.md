# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SimpleTextReader (易笺) — a pure TXT file reader providing an elegant reading experience. Runs as a browser extension (Chrome/Firefox/Edge), PWA, or self-hosted Docker container. Current version: 1.6.9.4.

## Commands

No root-level package.json. No test or lint tooling configured.

**Frontend development**: Open `index.html` directly in a browser via a local static server (e.g., `npx serve .` or VS Code Live Server). The client uses native ES modules with no bundler or transpiler.

**Server** (from `server/`):
```bash
npm install
npm run dev          # nodemon for development
npm start            # production (NODE_ENV=production node app/app.js)
npm run prisma:push  # sync PostgreSQL schema
```

**Build** (from `build-tools/`):
```bash
python build.py -e   # browser extensions only
python build.py -d   # Docker image only
python build.py -v 1.6.9.5   # build with specific version
```

**Docker**:
```bash
docker run -d -p 8866:8866 henryxrl/simpletextreader:latest
```

## Architecture

Monorepo with three top-level directories, no build step for client code.

### `client/` — Browser Frontend (ES Modules)

Entry: `index.html` → `init-webpage.js` → `app.js`. All code is native ES modules loaded directly by the browser.

**Key modules** (`client/app/modules/`):
- `features/reader.js` — Core reader: pagination, TOC, navigation. Exports `reader` singleton object and `initReader()`. Uses `PAGE_BREAKS` array for page boundaries, `FILE_CONTENT_CHUNKS` for content.
- `features/flow-reader.js` — Continuous scroll (flow) mode: sliding-window renderer that loads/unloads pages as user scrolls.
- `features/search.js` / `features/go-line.js` — Full text search and quick jump dialogs.
- `features/settings.js` — Declarative settings system via `SETTINGS_SCHEMA` + `MENU_SCHEMA` arrays. Settings bind to `CONFIG.*` paths and auto-persist to localStorage.
- `features/bookshelf.js` — IndexedDB-backed bookshelf with auto-generated covers.
- `file/file-handler.js` — File upload entry point (`FileHandler.handleSelectedFile`). Orchestrates encoding detection, metadata extraction, chunked processing, and UI rendering.
- `file/file-processor.js` — Client-side file processor wrapping `FileProcessorCore`. Delegates heavy processing to a Web Worker (`file-processor-worker.js`).
- `text/text-processor.js` — Facade over `TextProcessorCore` (shared) and `TextProcessorDOM` (client). `createDOM(structure)` converts pre-computed structure objects to DOM elements.
- `components/sidebar-splitview.js` — Resizable sidebar with TOC and progress display.

**Config** (`client/app/config/`):
- `constants.js` — Immutable app constants (`CONST_CONFIG`, `CONST_FILE`, `CONST_PAGINATION`, etc.)
- `variables.js` — Mutable runtime state (`VARS`): file content, pagination state, titles, footnotes. Has `reset()` method.
- `variables-dom.js` — DOM element references (`DOM_ELEMENT` with lazy getters), `RUNTIME_CONFIG` (URL params), `RUNTIME_VARS` (CSS vars proxy via `CSSVars`).

**Utils** (`client/app/utils/`):
- `base.js` — Low-level utilities (viewport checks, scroll helpers, DOM manipulation)
- `helpers-reader.js` — `GetScrollPositions()`, `setHistory()`, `setChapterTitleActive()`, `getTopLineNumber()`
- `helpers-ui.js` — Theme, drop zone, loading screen, pagination calculations
- `helpers-settings.js` — Settings UI component factories (`createCheckboxItem`, `createSelectorItem`, `createRangeItem`, `createColorItem`)

**Third-party libs** (`client/app/lib/`): jQuery, jschardet, tippy, sweetalert2, hyperlist, ipad-cursor, yaireo components, css-global-variables.

### `shared/` — Client/Server Shared Code

- `core/text/text-processor-core.js` — Core text processing: title detection, footnote extraction, language detection, text optimization. `process()` returns structure objects `{type, tag, content, lineNumber, elementType, dropCap, className}`.
- `core/file/file-processor-core.js` — File processing pipeline: decode, split, title pattern detection, line-by-line processing, pagination calculation. `processChunkStatic()` is the main entry (runs in worker).
- `core/text/pagination-calculator.js` — Page break calculation from processed lines and titles.
- `core/text/title-pattern-detector.js` — Dynamic title pattern detection from file content.
- `core/callback/callback-registry.js` — Global event bus (`cbReg`). `add()`/`go()` for pub-sub. Used extensively for cross-module communication (e.g., `toggleInfiniteScroll`, `loadSettings`, `fileBefore`, `fileAfter`, `resetUI`).

### `server/` — Node.js/Express Backend

Express app on port 8866. PostgreSQL via Prisma ORM. Provides book library API, WebSocket communication, and static file serving.

## Content Data Model

`FILE_CONTENT_CHUNKS` is an array of pre-processed structure objects (v1.6.4+):
```js
{ type: "title"|"heading"|"paragraph"|"empty"|"span",
  tag: "h1"|"h2"|"p"|"span",
  content: string,           // processed HTML text
  lineNumber: number,
  elementType: "t"|"h"|"p"|"e",
  className?: string,        // e.g., "first" for drop cap
  dropCap?: { content } }    // first letter for drop cap
```

`PAGE_BREAKS` is an array of line indices marking page boundaries. `PAGE_BREAKS[i]` is the first line of page `i+1`.

`ALL_TITLES` is an array of `[title, lineNum, shortTitle, isCustomOnly]` tuples.

## Key Patterns

**Rendering pipeline**: Raw text → `TextProcessorCore.process()` → structure objects in `FILE_CONTENT_CHUNKS` → `TextProcessorDOM.createFromStructure()` → DOM elements → append to `#content`.

**Settings system**: Declarative schema in `SETTINGS_SCHEMA` with `key`, `type`, `tab`, `bind` (CONFIG path), `default`, `persist`. `MENU_SCHEMA` defines tab/section layout. Settings UI is auto-generated. Side effects via `onApply` or `cbReg.go()` calls in `applySettings()`.

**Mode switching**: CSS attribute selectors on `#content` control visual modes:
- `data-page-mode="flow"` — continuous scroll mode
- `data-show-line-num="true"` — line numbers via `::before` pseudo-elements
- `data-reader-mode="log"` — monospace font, hidden TOC

**Inter-module communication**: `cbReg` (callback registry) is the primary event bus. Key topics: `toggleInfiniteScroll`, `toggleContinuousScroll`, `toggleShowLineNumbers`, `applyReaderMode`, `fileBefore`, `fileAfter`, `resetUI`, `loadSettings`, `applySettings`, `tocRendered`.

## URL Query Parameters

Control feature flags at runtime: `?no-bookshelf`, `?no-custom-fonts`, `?no-settings`, `?no-fast-open`, `?no-pagebreak-on-title`, `?always-process`, `?print-db`, `?upgrade-db`.

## Version and Release

Version tracked in `version.json` (bilingual changelog) and synced to manifests/README by `build.py`. CI/CD: pushing a `v*` tag triggers Azure CDN deployment via `.github/workflows/release.yml`.
