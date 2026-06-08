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
