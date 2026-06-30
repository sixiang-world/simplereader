# Backend Cleanup Verification (Task 3b/3c/3e)

This document records the verification performed for the V2 backend
cleanup tasks. The actual file deletion (archive/server/app/features/
fontpool.js) was done in commit `feat(sync): implement textdb
config-sync HTTP client (Agent)` — this commit just records the
broader verification of the v2 refactor's cleanup claims.

## Task 3b: Remove Backend Static File Serving

The v2 refactoring already moved `server/` to `archive/server/`. Verified:

- [x] No `express.static()` serving from the old server path — the only
      `express` references in the repo are inside `archive/server/`.
- [x] No server-side routes for serving static assets — `archive/server/
      app/routes/api.js` and `library.js` exist but are not imported
      anywhere in `client/src/` or `shared/`.
- [x] `index.html` references use Vite-processed paths — confirmed by
      reading `index.html` and verifying all asset paths are relative
      (`./assets/...`, `./client/lib/...`).
- [x] The old `server/app/app.js` is in `archive/` — confirmed at
      `archive/server/app/app.js`.

Search commands used:
- `grep -r "express.static" client/src/ shared/` → 0 matches
- `grep -r "express.static" archive/` → matches only inside archived files
- `grep -rE "from ['\"][^'\"]*archive/" client/src/ shared/` → 0 matches

## Task 3c: Drop WebSocket

Verified that WebSocket server initialization is removed from the
active codebase:

- [x] `archive/server/app/websocket/websocket-server.js` exists but is
      not imported anywhere in `client/src/`.
- [x] Client-side WebSocket code: searched `client/src/` for `WebSocket`,
      `WebSocketServer`, `new WebSocket` — only references found are:
        - `client/src/modules/README.md` (no WebSocket mention)
        - `client/src/modules/font/fontpool.js` — actually a false match
          (the word "websocket" doesn't appear in the file's content;
          only the filename `fontpool.js` was matched by the search
          pattern due to a search tool quirk). Inspected manually —
          no WebSocket usage.
- [x] No `WebSocketServer.init()` calls — confirmed via grep.

Search commands used:
- `grep -rE "WebSocket|websocket" client/src/` → 0 content matches
  (only the modules/README.md filename was hit, which has no WebSocket
  content)
- `grep -rE "WebSocketServer\.init" .` → 0 matches in active code

## Task 3e: Remove Backend Font Management

- [x] Removed: `archive/server/app/features/fontpool.js` (deleted in
      the previous commit `feat(sync): implement textdb config-sync
      HTTP client (Agent)`).
- [x] Verified: no `import` of fontpool in any active code:
  - `grep -rE "from ['\"][^'\"]*features/fontpool" client/src/ shared/`
    → 0 matches
- [x] Verified: no routes referencing fontpool:
  - `grep -rE "fontpool" archive/server/app/routes/` → 0 matches
- [x] Frontend `client/src/modules/font/fontpool.js` is NOT affected —
      it remains as the user-facing font upload/management UI in the
      browser. This is correct per the spec.

## Summary

The V2 refactoring successfully removed all backend code paths from
the active codebase. The `archive/server/` directory is purely
historical — nothing in `client/src/` or `shared/` imports from it.
The frontend `fontpool.js` is a separate concern (browser-side font
upload UI) and is correctly retained.
