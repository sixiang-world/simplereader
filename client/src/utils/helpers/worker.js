/**
 * @fileoverview Helper functions for worker creation and module imports in different environments
 * @module client/src/utils/helpers-worker
 * @requires shared/utils/logger
 */

import { Logger } from "../../../../shared/utils/logger.js";

/**
 * Logger instance
 */
const logger = Logger.getLogger("HelpersWorker", false);

/**
 * Checks if running in extension environment
 * @returns {boolean}
 */
function isExtension() {
    return !!(
        // Test by protocol
        (
            location.protocol === "chrome-extension:" || // Chrome/Edge
            location.protocol === "moz-extension:" || // Firefox
            location.protocol === "safari-extension:" || // Safari
            // Test by runtime API
            (typeof chrome !== "undefined" && chrome?.runtime?.id) || // Chrome/Edge
            (typeof browser !== "undefined" && browser?.runtime?.id) || // Firefox
            (typeof safari !== "undefined" && safari?.extension)
        ) // Safari
    );
}

/**
 * Gets extension URL for a path
 * @param {string} path - Path to the file
 * @returns {string} Full URL
 */
function getExtensionUrl(path) {
    // Clean the path first
    const cleanPath = path.startsWith("/") ? path.slice(1) : path;

    // Chrome/Edge
    if (location.protocol === "chrome-extension:") {
        if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
            return chrome.runtime.getURL(cleanPath);
        }
        return `${location.origin}/${cleanPath}`;
    }

    // Firefox
    if (location.protocol === "moz-extension:") {
        if (typeof browser !== "undefined" && browser.runtime?.getURL) {
            return browser.runtime.getURL(cleanPath);
        }
        return `${location.origin}/${cleanPath}`;
    }

    // Safari
    if (location.protocol === "safari-extension:") {
        if (typeof safari !== "undefined" && safari.extension?.baseURI) {
            return safari.extension.baseURI + cleanPath;
        }
        return `${location.origin}/${cleanPath}`;
    }

    throw new Error("Unable to get URL in extension environment.");
}

/**
 * Resolve app-root paths from source modules or Vite's assets directory.
 * Keep the deployment prefix (e.g. /reader/) in both cases. Workers and
 * imported shared modules use the same root; extensions use runtime.getURL.
 * @param {string} absolutePath
 * @param {string} baseUrl
 * @returns {string}
 */
export function resolveWorkerUrl(absolutePath, baseUrl) {
    if (/^https?:\/\//.test(absolutePath)) return absolutePath;
    const base = new URL(baseUrl);
    const parts = base.pathname.split("/");
    // Prefer the nearest known app directory, so a deployment directory
    // itself named "client" does not replace the actual source root.
    let marker = -1;
    for (let i = parts.length - 1; i >= 0; i--) {
        if (["client", "shared", "assets"].includes(parts[i])) { marker = i; break; }
    }
    const appRoot = marker === -1 ? new URL("./", base) : new URL(parts.slice(0, marker).join("/") + "/", base);
    return new URL(absolutePath.replace(/^\/+/, ""), appRoot).href;
}

/**
 * Validates and resolves URL for a given path
 * @param {string} path - The path to resolve
 * @param {string} baseUrl - Base URL for resolution
 * @param {string} context - Context for error messages (e.g., "worker", "module")
 * @returns {string} Resolved URL
 * @throws {Error} If path is invalid
 */
function resolveUrl(path, baseUrl, context = "resource") {
    // Validate path
    if (path.startsWith(".")) {
        throw new Error(`${context} path must not start with '.'`);
    }

    // Resolve URL based on environment
    if (isExtension()) {
        return getExtensionUrl(path);
    } else {
        return resolveWorkerUrl(path, baseUrl);
    }
}

/**
 * Creates a worker with proper URL handling
 * @param {string} absolutePath - Absolute path to worker file
 * @param {string} baseUrl - Base URL (import.meta.url from caller)
 * @param {Object} options - Worker options
 * @returns {Worker} Created worker
 */
export function createWorker(absolutePath, baseUrl, options = { type: "module" }) {
    try {
        const workerUrl = resolveUrl(absolutePath, baseUrl, "worker");

        logger.log("Creating worker", {
            absolutePath,
            baseUrl,
            workerUrl,
            isExtension: isExtension(),
        });

        return new Worker(workerUrl, options);
    } catch (error) {
        const errorMessage = `Failed to create worker for path '${absolutePath}': ${error.message}`;
        logger.error(errorMessage);
        throw new Error(errorMessage);
    }
}

/**
 * Extracts the default export from a module
 * @param {Object} module - The imported module
 * @returns {*} The default export or the module itself
 */
function extractDefaultExport(module) {
    if (module.default) {
        return module.default;
    }

    const namedExports = Object.keys(module);
    if (namedExports.length === 1) {
        return module[namedExports[0]];
    }

    return module;
}

/**
 * Imports dependencies with proper path handling
 * @param {Array<string>} absolutePaths - Array of absolute paths (must not start with ".")
 * @param {string} baseUrl - Base URL (import.meta.url from caller)
 * @returns {Promise<Array>} Imported modules
 */
export async function importDependencies(absolutePaths, baseUrl) {
    try {
        const imports = await Promise.all(
            absolutePaths.map(async (path) => {
                const moduleUrl = resolveUrl(path, baseUrl, "module");

                logger.log("Importing module:", { path, moduleUrl });
                // /* @vite-ignore */ because moduleUrl is resolved at runtime
                // (the path is computed from absolutePath + baseUrl via
                // resolveWorkerUrl, which Vite cannot statically analyze).
                const module = await import(/* @vite-ignore */ moduleUrl);

                return extractDefaultExport(module);
            })
        );

        return imports;
    } catch (error) {
        const errorMessage = `Failed to import dependencies: ${error.message}`;
        logger.error(errorMessage);
        throw new Error(errorMessage);
    }
}
