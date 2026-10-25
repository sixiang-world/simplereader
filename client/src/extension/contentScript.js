/**
 * @fileoverview The content script for the extension.
 *
 * This script is responsible for detecting and processing `.txt` files opened in the browser.
 * It extracts the content from the file, converts it to Base64, and sends it to the extension's background script.
 *
 * @module client/src/extension/contentScript
 */

/**
 * @function contentScript
 * @description The content script for the extension.
 *
 * This script is responsible for detecting and processing `.txt` files opened in the browser.
 * It extracts the content from the file, converts it to Base64, and sends it to the extension's background script.
 */
(async function () {
    /**
     * Get the extension API
     */
    const api = typeof chrome !== "undefined" ? chrome : typeof browser !== "undefined" ? browser : null;
    if (!api?.runtime) return;

    /**
     * Check if the current URL matches the `.txt` file pattern
     */
    async function isTextFile(url) {
        const urlObj = new URL(url);
        if (urlObj.searchParams.get("readerSkip") === "1") return false;
        const txtFileRegex = /^(?:file|https?):\/\/.*\/[^\/]+\.txt(?:\?.*|#.*|$)/;
        if (urlObj.pathname.endsWith(".txt") && txtFileRegex.test(urlObj.href)) {
            // Ignore links with query parameters suggesting downloads
            if (urlObj.searchParams.has("dl")) {
                const dlValue = urlObj.searchParams.get("dl");
                if (dlValue === "0") {
                    return false; // Dropbox-like URL suggesting a download link
                }
            }

            // For file:// URLs, we can't do a HEAD request
            if (url.startsWith("file://")) {
                return true;
            }

            // Perform a HEAD request to check Content-Type
            try {
                const response = await fetch(url, { method: "HEAD" });
                const contentType = response.headers.get("Content-Type");
                return contentType && contentType.startsWith("text/plain");
            } catch (error) {
                console.error("Error checking Content-Type:", error);
                return false;
            }
        }

        return false; // If not ending with .txt
    }

    /**
     * Check if the current URL matches the `.txt` file pattern
     */
    if (await isTextFile(location.href)) {
        const fileUrl = location.href;

        try {
            // Keep the original document readable until durable handoff and
            // navigation succeed. Storage/quota errors must never hide the file.
            if (document.readyState !== "complete") {
                await new Promise((resolve) => {
                    document.addEventListener("DOMContentLoaded", resolve, { once: true });
                });
            }

            // Ensure valid content
            if (!document.body && !document.documentElement) {
                throw new Error("Document not ready");
            }

            // Retrieve content from pre tag (Firefox/Chrome usually puts txt file content in pre tag)
            const content =
                document.querySelector("pre")?.textContent ||
                document.body?.textContent ||
                document.documentElement?.textContent;

            if (typeof content !== "string") {
                throw new Error("No content found");
            }

            // Convert content to Base64
            const fileName = decodeURIComponent(new URL(fileUrl).pathname.split("/").pop());
            const encoder = new TextEncoder();
            const uint8Array = encoder.encode(content);
            // Avoid Array.from(...).map(...).join(...) making millions of
            // boxed byte entries for large text documents.
            let binary = "";
            for (let offset = 0; offset < uint8Array.length; offset += 0x8000) {
                binary += String.fromCharCode(...uint8Array.subarray(offset, offset + 0x8000));
            }
            const base64Content = btoa(binary);

            // Directly send replaceCurrentTab message
            const message = { action: "replaceCurrentTab", fileName,
                fileType: "text/plain", fileContent: base64Content };
            const result = await new Promise((resolve, reject) => {
                if (typeof chrome !== "undefined") {
                    api.runtime.sendMessage(message, (response) => {
                        if (api.runtime.lastError) reject(new Error(api.runtime.lastError.message));
                        else resolve(response);
                    });
                } else {
                    api.runtime.sendMessage(message).then(resolve, reject);
                }
            });
            if (!result?.success) throw new Error(result?.error || "Reader handoff failed");
        } catch (error) {
            console.error("Failed to process the text file:", error);
        }
    }
})();
