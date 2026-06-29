# core/

The `core/` directory hosts cross-cutting infrastructure modules that are
**not** feature-specific. These modules are intended to be imported by any
feature that needs their capability, without creating circular dependencies
on the feature modules.

## Contents

### `hooks.js`

A typed, ordered, async-aware hook pipeline for **transform pipelines**
where each registered hook can mutate a value before passing it on.

This is intentionally separate from the existing `cbReg` event bus (in
`shared/core/callback/callback-registry.js`). `cbReg` is a generic pub/sub
used heavily throughout the codebase for module coordination; the hook
system is specifically for pipelines where the return value threads through
each participant.

**Reserved hook names** (not yet fired anywhere — see `hooks.js` for the
full list and contracts):
- `file:beforeProcess` — transform or abort a File before processing
- `file:afterProcess`  — transform book data after processing
- `reader:beforeRender` — transform before DOM render
- `reader:afterRender`  — side-effects after DOM render

### `presets.js`

Stub for the planned "排版预设快捷切换" feature. Defines the public API
(`savePreset`, `loadPreset`, `deletePreset`, `applyPreset`,
`resolvePresetFromURL`) and the localStorage storage format, but does NOT
yet wire into `settings.js`. When the feature is implemented, the wiring
points are:
1. `settings.js` `loadSettings()` should call `resolvePresetFromURL()`
   after `parseURLSettings()` runs.
2. The settings menu should expose a "Presets" tab.

### `config-sync.js`

Stub for the planned "运行时配置同步" feature (sync to
`textdb.hunluan.space`). Defines the public API (`pullOnBoot`,
`pushConfig`, `pushOnSettingsChange`, `getSyncToken`, `setSyncToken`)
but the methods are no-ops that log warnings. When the feature is
implemented, the wiring points are:
1. `app.js` `onReady` should call `pullOnBoot()` after `settings.enable()`.
2. `settings.js` `saveSettings()` should call `pushOnSettingsChange()`.

## When to add a new module to `core/`

A module belongs in `core/` if **all** of the following are true:
- It is not specific to any single feature (reader, bookshelf, settings, etc.).
- It has no DOM dependencies (or only via explicitly-injected elements).
- It is stable enough that other features can depend on its API without
  fear of breaking changes.

If a module is feature-specific, put it in `modules/features/<feature>/`
instead. If it's a small pure utility, put it in `utils/`.
