/** Durable, per-tab handoff between a TXT content script and the reader page. */
(function () {
    const callbackAPI = typeof chrome !== "undefined";
    const api = callbackAPI ? chrome : typeof browser !== "undefined" ? browser : null;
    if (!api?.runtime || !api?.storage?.local) return;
    const prefix = "pendingReaderFile:";
    const maxAge = 30 * 60 * 1000;

    function call(owner, method, ...args) {
        if (!callbackAPI) return owner[method](...args);
        return new Promise((resolve, reject) => {
            owner[method](...args, (result) => {
                const error = api.runtime.lastError;
                if (error) reject(new Error(error.message));
                else resolve(result);
            });
        });
    }

    const action = api.action || api.browserAction;
    action?.onClicked?.addListener(() => {
        call(api.tabs, "create", { url: api.runtime.getURL("index.html"), active: true })
            .catch((error) => console.error("Cannot open reader:", error.message));
    });
    api.tabs.onRemoved?.addListener((tabId) => {
        call(api.storage.local, "remove", prefix + tabId).catch(() => {});
    });

    function isReaderRequest(url, requestId) {
        try {
            const actual = new URL(url);
            const expected = new URL(api.runtime.getURL("index.html"));
            return actual.protocol === expected.protocol && actual.host === expected.host &&
                actual.pathname === expected.pathname &&
                actual.searchParams.get("extensionRequest") === requestId;
        } catch {
            return false;
        }
    }

    async function handle(message, sender) {
        // Content scripts have sender.tab; extension pages generally do not.
        // Never trust a content script's claimed tabId over the platform sender.
        let tabId = sender.tab?.id;
        if (!Number.isInteger(tabId) && message.action !== "replaceCurrentTab") {
            if (!Number.isInteger(message.tabId) || !isReaderRequest(sender.url, message.requestId)) {
                throw new Error("A reader tab is required");
            }
            const tab = await call(api.tabs, "get", message.tabId);
            if (tab?.id !== message.tabId || !isReaderRequest(tab.url, message.requestId)) {
                throw new Error("Reader tab does not match the pending request");
            }
            tabId = message.tabId;
        }
        if (!Number.isInteger(tabId)) throw new Error("A reader tab is required");
        const key = prefix + tabId;
        if (message.action === "replaceCurrentTab") {
            const original = new URL(sender.url);
            if (original.protocol !== "file:" || !original.pathname.toLowerCase().endsWith(".txt")) {
                throw new Error("Only local TXT documents can be handed to the reader");
            }
            if (typeof message.fileName !== "string" || !message.fileName ||
                message.fileType !== "text/plain" || typeof message.fileContent !== "string" ||
                (message.fileContent.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(message.fileContent))) {
                throw new Error("Invalid file handoff");
            }
            const requestId = crypto.randomUUID();
            await call(api.storage.local, "set", { [key]: {
                requestId, createdAt: Date.now(), originalUrl: original.href,
                file: { action: "loadFile", fileName: message.fileName,
                    fileType: message.fileType, fileContent: message.fileContent },
            } });
            try {
                await call(api.tabs, "update", tabId, {
                    url: api.runtime.getURL("index.html") + "?extensionRequest=" + requestId,
                });
            } catch (error) {
                await call(api.storage.local, "remove", key);
                throw error;
            }
            return { success: true, requestId };
        }

        // Only the extension reader page in the original tab can claim/ack data.
        if (!isReaderRequest(sender.url, message.requestId)) {
            throw new Error("Only the reader page can access a pending file");
        }
        const record = (await call(api.storage.local, "get", key))[key];
        if (!record || record.requestId !== message.requestId) throw new Error("Pending file not found");
        if (message.action === "claimPendingFile") {
            if (Date.now() - record.createdAt > maxAge) {
                throw new Error("File handoff expired; restore the original document");
            }
            return { success: true, file: record.file };
        }
        if (message.action === "ackPendingFile") {
            await call(api.storage.local, "remove", key);
            return { success: true };
        }
        if (message.action === "restorePendingFile") {
            const original = new URL(record.originalUrl);
            original.searchParams.set("readerSkip", "1");
            await call(api.tabs, "update", tabId, { url: original.href });
            await call(api.storage.local, "remove", key);
            return { success: true };
        }
        throw new Error("Unsupported reader request");
    }

    const actions = new Set(["replaceCurrentTab", "claimPendingFile", "ackPendingFile", "restorePendingFile"]);
    api.runtime.onMessage.addListener((message, sender, respond) => {
        if (!actions.has(message?.action)) return false;
        handle(message, sender).then(respond, (error) => respond({ success: false, error: error.message }));
        return true;
    });
})();
