/**
 * @fileoverview Book-related helper functions for managing book metadata in localStorage
 *
 * This module provides utility functions for:
 * - Managing book reading timestamps
 * - Tracking book storage location (server/local)
 * - Managing book source information
 *
 * @module client/src/utils/helpers-bookshelf
 */

import { readBookProgress, writeBookProgress } from "../../core/book-progress.js";

export function setBookLastReadTimestamp(bookId) {
    writeBookProgress(bookId, "opened", Date.now());
}

export function getBookLastReadTimestamp(bookId) {
    const value = readBookProgress(bookId, "opened");
    return value && /^[0-9]+$/.test(value) ? value : "";
}

/**
 * Sets whether a book is stored on the server
 * @param {string} filename - The name of the book file
 * @param {boolean} isOnserver - Whether the book is on server
 */
export function setIsOnServer(filename, isOnserver) {
    let final_isOnServer = isOnserver || false;
    localStorage.setItem(`${filename}_isOnServer`, final_isOnServer);
}

/**
 * Checks if a book is stored on the server
 * @param {string} filename - The name of the book file
 * @returns {boolean} True if book is on server, false otherwise
 */
export function getIsOnServer(filename) {
    if (localStorage.getItem(`${filename}_isOnServer`)) {
        return localStorage.getItem(`${filename}_isOnServer`).toLowerCase() === "true";
    }
    return false;
}

/**
 * Sets whether a book is from local storage
 * @param {string} filename - The name of the book file
 * @param {boolean} isFromLocal - Whether the book is from local storage
 */
export function setIsFromLocal(filename, isFromLocal) {
    let final_isFromLocal = isFromLocal && true;
    localStorage.setItem(`${filename}_isFromLocal`, final_isFromLocal);
}

/**
 * Checks if a book is from local storage
 * @param {string} filename - The name of the book file
 * @returns {boolean} True if book is from local storage, false otherwise
 */
export function getIsFromLocal(filename) {
    if (localStorage.getItem(`${filename}_isFromLocal`)) {
        return localStorage.getItem(`${filename}_isFromLocal`).toLowerCase() === "true";
    }
    return false;
}
