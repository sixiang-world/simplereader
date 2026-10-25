function hasControlCharacters(text) {
    for (const char of text) {
        const code = char.charCodeAt(0);
        if (code < 32 || code === 127) return true;
    }
    return false;
}

/** Resolve an EPUB URI against a decoded ZIP entry path, without network access. */
export function resolveEpubHref(href, basePath = "") {
    if (typeof href !== "string" || !href || hasControlCharacters(href) || href.includes("\\")) return null;
    href = href.trim();
    if (!href) return null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return null;
    const hash = href.indexOf("#");
    const rawPath = (hash < 0 ? href : href.slice(0, hash)).split("?")[0];
    let fragment;
    let parts;
    try {
        fragment = hash < 0 ? "" : decodeURIComponent(href.slice(hash + 1));
        parts = rawPath.split("/").map(part => {
            const decoded = decodeURIComponent(part);
            if (decoded.includes("/") || decoded.includes("\\") || hasControlCharacters(decoded)) throw new Error("Invalid EPUB path segment");
            return decoded;
        });
    } catch {
        return null;
    }
    if (hasControlCharacters(fragment)) return null;
    const resolved = rawPath.startsWith("/") ? [] : basePath.split("/").slice(0, -1);
    if (!rawPath) {
        if (!basePath) return null;
        return { path: basePath, fragment, key: fragment ? `${basePath}#${fragment}` : basePath };
    }
    for (const part of parts) {
        if (!part || part === ".") continue;
        if (part === "..") {
            if (!resolved.length) return null;
            resolved.pop();
        } else resolved.push(part);
    }
    const path = resolved.join("/");
    if (!path) return null;
    return { path, fragment, key: fragment ? `${path}#${fragment}` : path };
}
