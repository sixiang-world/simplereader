# Extension handoff validation

`pnpm exec playwright-core install chromium` followed by `npm run test:extension`
packages the actual Chrome extension, loads it in a fresh persistent Chromium
profile and exercises the extension reader page's claim → TXT processing → ACK.
Set `CHROMIUM_EXECUTABLE_PATH` if an extension-enabled browser is supplied by
the environment. `npm run test:browser` separately runs the reader readiness
integration with an API transport stub; it does not claim a real extension test.

This cloud machine's managed Chromium policy sets
`ExtensionInstallBlocklist: ["*"]`. Real unpacked-extension loading is blocked;
that policy was not changed. The optional full test fails clearly here and is
not silently skipped. Downloading the Playwright browser was also denied by
the network proxy for `playwright.download.prss.microsoft.com`. Run the full
command in an environment allowing extensions (and the official browser
artifact destination), then validate Firefox separately before claiming full
cross-browser release readiness.

The content script keeps the original document visible until durable handoff.
Records are scoped to a tab/request and are acknowledged only after processing.
Reader pages have no `sender.tab` in Chrome: they send `tabs.getCurrent().id`,
and background validates both the sender URL and the actual tab URL. Failure
restores the original URL with a bypass marker; if that fails, the reader shows
a retry button. Storage/message quotas are bounded by browser policy; oversized
files fail without hiding the original document. No new unrestricted permission
or unlimited storage permission is requested.
