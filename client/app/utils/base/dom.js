/**
 * @fileoverview DOM manipulation, viewport/visibility checks, scroll control, event helpers, stylesheet management.
 *
 * (v2 refactor) Extracted from the original client/app/utils/base.js
 * monolith. The original base.js now re-exports from these submodules
 * so existing import paths continue to work unchanged.
 *
 * @module client/app/utils/base/dom
 */

import * as CONFIG_CONST from "../../config/constants.js";

/**
 * Removes the hashbang (#!) from the current URL using the History API.
 * @public
 * @throws {Error} If History API is not supported by the browser
 * @see {@link https://developer.mozilla.org/docs/Web/API/History/pushState}
 */
export function removeHashbang() {
    const currentPath = window.location.pathname;
    if (window.location.hash) {
        history.pushState("", document.title, currentPath);
    }
}


/**
 * Removes file extension from a filename
 * @public
 * @param {string} filename - The filename to process
 * @returns {string} Filename without extension
 */
export function removeFileExtension(filename) {
    return filename.replace(CONFIG_CONST.CONST_FILE.EXT_REGEX, "");
}


/**
 * Finds the index of a string within concatenated arrays
 * @public
 * @param {Array<string>[]} arrays - Array of string arrays to search in
 * @param {string} searchString - String to search for
 * @returns {number} Index of the string, or -1 if not found
 */
export function findStringIndex(arrays, searchString) {
    let totalOffset = 0;

    // Loop through each sub-array
    for (let i = 0; i < arrays.length; i++) {
        const currentArray = arrays[i];
        const index = currentArray.indexOf(searchString);

        // If the string is found in the current array
        if (index !== -1) {
            return totalOffset + index;
        }

        // Update the offset by adding the length of the current array
        totalOffset += currentArray.length;
    }

    // Return -1 if the string is not found in any array
    return -1;
}


/**
 * Generates a random float between two numbers
 * @public
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Random float between min and max
 */
export function randomFloatFromInterval(min, max) {
    return Math.random() * (max - min) + min;
}


/**
 * Checks if a variable is defined and has a valid value
 * @public
 * @param {*} v - The variable to check
 * @returns {boolean} True if variable is defined and valid
 */
export function isVariableDefined(v) {
    return v !== "undefined" && v !== "" && v !== null && v !== undefined && v !== NaN;
}


/**
 * Gets the size of an element in pixels
 * Credit: https://stackoverflow.com/questions/10463518/converting-em-to-px-in-javascript-and-getting-default-font-size
 * @public
 * @param {string} size - CSS size value (e.g., "1em")
 * @param {HTMLElement} parent - Parent element for context
 * @returns {number} Size in pixels
 */
export function getSize(size = "1em", parent = document.body) {
    let l = document.createElement("div");
    l.style.visibility = "hidden";
    l.style.boxSize = "content-box";
    l.style.position = "absolute";
    l.style.maxHeight = "none";
    l.style.height = size;
    parent.appendChild(l);
    size = l.clientHeight;
    l.remove();
    return size;
}


/**
 * Gets precise size measurement in pixels with better accuracy for large values
 * @public
 * @param {string} size - CSS size value (e.g., "1em")
 * @param {HTMLElement} parent - Parent element for context
 * @returns {number} Precise size in pixels, or -1 if parent is undefined
 */
export function getSizePrecise(size = "1em", parent = document.body) {
    if (isVariableDefined(parent)) {
        let l = document.createElement("div"),
            i = 1,
            s,
            t;
        l.style.visibility = "hidden";
        l.style.boxSize = "content-box";
        l.style.position = "absolute";
        l.style.maxHeight = "none";
        l.style.height = size;
        parent.appendChild(l);
        t = l.clientHeight;
        do {
            if (t > 1789569.6) {
                break;
            }
            s = t;
            i *= 10;
            l.style.height = `calc(${i}*${size})`;
            t = l.clientHeight;
        } while (t !== s * 10);
        l.remove();
        return t / i;
    } else {
        return -1;
    }
}


/**
 * Checks if an element is visible in the viewport
 * Credit: https://www.javascripttutorial.net/dom/css/check-if-an-element-is-visible-in-the-viewport/
 * @public
 * @param {HTMLElement} el - Element to check
 * @returns {boolean} True if element is visible
 */
export function isInViewport(el) {
    try {
        const rect = el.getBoundingClientRect();

        // Get all child elements
        const children = el.querySelectorAll("*");
        let extendedRect = { top: rect.top, bottom: rect.bottom };

        // Extend the rect to account for margins of all child elements
        children.forEach((child) => {
            const childRect = child.getBoundingClientRect();
            const style = getComputedStyle(child);

            // Parse the computed margin values for the child
            const marginTop = parseFloat(style.marginTop) || 0;
            const marginBottom = parseFloat(style.marginBottom) || 0;

            // Extend the boundaries
            extendedRect.top = Math.min(extendedRect.top, childRect.top - marginTop);
            extendedRect.bottom = Math.max(extendedRect.bottom, childRect.bottom + marginBottom);
        });

        // Check if any part of the extended rect is in the viewport
        return (
            extendedRect.bottom >= 0 &&
            extendedRect.top <= (window.innerHeight || document.documentElement.clientHeight)
        );
    } catch (error) {
        return false;
    }
}


/**
 * Checks if an element is visible within a container's viewport
 * @public
 * @param {HTMLElement} container - Container element
 * @param {HTMLElement} el - Element to check
 * @param {number} margin - Margin to consider (default: 0)
 * @returns {boolean} True if element is visible in container
 */
export function isInContainerViewport(container, el, margin = 0) {
    try {
        const containerRect = container.getBoundingClientRect();
        const rect = el.getBoundingClientRect();
        return rect.top >= containerRect.top + margin && rect.bottom <= containerRect.bottom - margin;
    } catch (error) {
        return false;
    }
}


/**
 * Creates an HTML element from a string
 * @public
 * @param {string} htmlString - HTML string to convert
 * @returns {HTMLElement} Created element
 */
export function createElementFromHTML(htmlString) {
    const div = document.createElement("div");
    div.innerHTML = htmlString.trim();
    return div.firstElementChild;
}


/**
 * Simulates a click event on an element
 * @public
 * @param {HTMLElement} elem - Element to click
 * @returns {boolean} True if event was dispatched successfully
 */
export function simulateClick(elem) {
    const e = new MouseEvent("click", {
        view: window,
        bubbles: true,
        cancelable: true,
    });
    console.log("simulateClick");
    return elem.dispatchEvent(e);
}


/**
 * Checks if text ellipsis is active on an element
 * @public
 * @param {HTMLElement} element - Element to check
 * @returns {boolean} True if ellipsis is active
 */
export function isEllipsisActive(element) {
    if (!(element instanceof HTMLElement)) {
        console.warn("Invalid element provided to isEllipsisActive");
        return false;
    }

    // Check if element has footnote indicator
    function getFootnoteIndicator(el) {
        const footnote = el.querySelector('a[rel="footnote"]');
        return {
            has: !!footnote,
            node: footnote,
        };
    }
    let footnoteWidth = 0;
    const hasFootnote = getFootnoteIndicator(element);
    if (hasFootnote.has) {
        footnoteWidth = hasFootnote.node.getBoundingClientRect().width;
    }

    // Get the computed styles
    const computedStyle = window.getComputedStyle(element);
    const font = computedStyle.font || `${computedStyle.fontSize} ${computedStyle.fontFamily}`;

    // Create a canvas element to measure text width
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    context.font = font;

    // Measure the actual width of the text in pixels
    const text = element.textContent.trim();
    const textWidth = context.measureText(text).width + footnoteWidth;

    // Compare the text width with the element's visible width
    // return textWidth > element.clientWidth;
    return textWidth > element.getBoundingClientRect().width;
}


/**
 * Calculates the similarity between two rectangles A (reference) and B (incoming)
 * based on area and aspect ratio.
 * @public
 * @param {Object} rectA - The reference rectangle with fixed dimensions.
 * @param {number} rectA.width - The width of rectangle A.
 * @param {number} rectA.height - The height of rectangle A.
 * @param {Object} rectB - The incoming rectangle to compare.
 * @param {number} rectB.width - The width of rectangle B.
 * @param {number} rectB.height - The height of rectangle B.
 * @returns {number} - A similarity score between 0 and 1 (1 means identical).
 */
export function calculateRectangleSimilarity(rectA, rectB) {
    // Calculate the area of both rectangles
    const areaA = rectA.width * rectA.height;
    const areaB = rectB.width * rectB.height;

    // Calculate the area similarity (1 means identical area)
    const areaSimilarity = 1 - Math.abs((areaB - areaA) / areaA);

    // // Calculate the aspect ratio of both rectangles
    // const aspectRatioA = rectA.width / rectA.height;
    // const aspectRatioB = rectB.width / rectB.height;

    // // Calculate the aspect ratio similarity (1 means identical ratio)
    // const aspectRatioSimilarity = 1 - Math.abs((aspectRatioB - aspectRatioA) / aspectRatioA);

    // // Combine the area and aspect ratio similarity with equal weighting
    // const similarityScore = 0.5 * areaSimilarity + 0.5 * aspectRatioSimilarity;

    const similarityScore = areaSimilarity;

    // Ensure the similarity score is within the range [0, 1]
    return Math.max(0, Math.min(1, similarityScore));
}


/**
 * Returns the element height including margins
 * @public
 * @param {HTMLElement} element - Element to measure
 * @returns {number} Element height including margins
 */
export function outerHeight(element) {
    const height = element?.offsetHeight ?? 0;
    if (height === 0) return 0;

    const style = window.getComputedStyle(element) ?? null;
    if (style === null) return 0;

    return ["top", "bottom"]
        .map((side) => parseInt(style[`margin-${side}`]))
        .reduce((total, side) => total + side, height);
}


/**
 * Adds footnotes to the DOM (for { [markerCode]: { [order]: {content, ...} } } structure).
 * @public
 * @param {Object} footnotesObj - The nested footnotes object.
 * @param {HTMLElement} footnoteContainer - Footnote container element
 * @note Calling this function will create a visible list of all footnotes in the DOM.
 *       While this approach works, it is not optimal for documents with many footnotes,
 *       as it can add a large number of DOM elements and impact performance.
 *       For better scalability and performance, use the Footnotes popup system with
 *       setFootnoteLookup() to display footnotes dynamically as needed.
 */
export function addFootnotesToDOM(footnotesObj, footnoteContainer) {
    footnoteContainer.innerHTML = "";

    // Gather entries in markerCode, then order order.
    const entries = [];
    for (const markerCode of Object.keys(footnotesObj).sort((a, b) => Number(a) - Number(b))) {
        const ordersObj = footnotesObj[markerCode];
        for (const order of Object.keys(ordersObj).sort((a, b) => Number(a) - Number(b))) {
            const footnote = ordersObj[order];
            // Compose footnote HTML string with correct id (same as anchor href)
            entries.push({
                html: `<li id="fn-${markerCode}-${order}">${footnote.content}</li>`,
                markerCode,
                order,
            });
        }
    }

    // Create an ordered list for display (optional; or use a custom wrapper)
    const ol = document.createElement("ol");
    entries.forEach(({ html }) => {
        const tempElement = document.createElement("div");
        tempElement.innerHTML = html;
        ol.appendChild(tempElement.firstChild);
    });

    footnoteContainer.appendChild(ol);
}


/**
 * Pairs anchors and footnotes from a unified timeline.
 * @param {Array} timeline - Array of events (anchors and footnotes) in chronological order.
 * @returns {Object} pairedFootnotes: { [markerCode]: [footnote or notfound HTML] }
 */
export function pairAnchorsAndFootnotes(timeline) {
    const pairedFootnotes = {};
    const anchorQueue = [];
    let lastType = null;

    // Check timeline
    if (!Array.isArray(timeline)) {
        // console.warn("Invalid timeline provided to pairAnchorsAndFootnotes");
        return pairedFootnotes;
    }

    // Pair anchors and footnotes
    timeline.forEach((item) => {
        if (item.type === CONFIG_CONST.CONST_FOOTNOTE.TYPES.ANCHOR) {
            if (lastType === CONFIG_CONST.CONST_FOOTNOTE.TYPES.FOOTNOTE) {
                // Flush excessive anchors from previous group
                anchorQueue.forEach((a) => {
                    if (!pairedFootnotes[a.markerCode]) pairedFootnotes[a.markerCode] = [];
                    pairedFootnotes[a.markerCode][a.index] = CONFIG_CONST.CONST_FOOTNOTE.NOTFOUND;
                });
                anchorQueue.length = 0;
            }
            anchorQueue.push(item);
            lastType = CONFIG_CONST.CONST_FOOTNOTE.TYPES.ANCHOR;
        } else if (item.type === CONFIG_CONST.CONST_FOOTNOTE.TYPES.FOOTNOTE) {
            const idx = anchorQueue.findIndex((a) => a.markerCode === item.markerCode);
            if (idx !== -1) {
                const anchor = anchorQueue.splice(idx, 1)[0];
                if (!pairedFootnotes[item.markerCode]) pairedFootnotes[item.markerCode] = [];
                pairedFootnotes[item.markerCode][anchor.index] = item.content;
            } else {
                // Unpaired footnote, handle if needed
            }
            lastType = CONFIG_CONST.CONST_FOOTNOTE.TYPES.FOOTNOTE;
        }
    });

    // Final flush: leftover anchors after all events
    if (anchorQueue.length > 0) {
        anchorQueue.forEach((a) => {
            if (!pairedFootnotes[a.markerCode]) pairedFootnotes[a.markerCode] = [];
            pairedFootnotes[a.markerCode][a.index] = CONFIG_CONST.CONST_FOOTNOTE.NOTFOUND;
        });
    }

    return pairedFootnotes;
}


/**
 * Triggers a custom event
 * @public
 * @param {string} eventName - Event name
 * @param {Object} detail - Event detail
 * @param {boolean} bubbles - Whether to bubble the event
 * @param {boolean} cancelable - Whether the event is cancelable
 */
export function triggerCustomEvent(eventName, detail = {}, bubbles = true, cancelable = true) {
    const e = new CustomEvent(eventName, {
        detail,
        bubbles,
        cancelable,
    });
    document.dispatchEvent(e);
}


/**
 * Dynamically sets the stroke-dasharray and stroke-dashoffset for SVG paths for animation
 * @public
 * @param {HTMLElement} container - Container element
 */
export function setSvgPathLength(container) {
    const paths = container.querySelectorAll("svg .tofill");
    paths.forEach((path) => {
        const len = path.getTotalLength() + 1;
        path.style.setProperty("--ui_svgPathLength", len);
    });
}


/**
 * Gets the canvas element associated with the current book
 * @public
 * @param {string} bookName - The name of the book
 * @returns {HTMLCanvasElement|null}
 */
export function getBookCoverCanvas(bookName) {
    const bookElement = document.querySelector(`.book[data-filename="${bookName}"]`);
    return bookElement?.querySelector(".cover-canvas");
}


/**
 * Enables scrolling on the document
 * @public
 */
export function enableScroll() {
    document.body.style.overflow = "";
    document.documentElement.style.overflow = "";
    document.body.style.overscrollBehavior = "";
    document.documentElement.style.overscrollBehavior = "";
}


/**
 * Disables scrolling on the document
 * @public
 */
export function disableScroll() {
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    document.documentElement.style.overscrollBehavior = "none";
}


/**
 * Checks if an element is within a specified container or an array of containers
 * @public
 * @param {Element} element - The element to check
 * @param {Element|Element[]|HTMLCollection|(Element|HTMLCollection)[]} containers - The container or an array of containers
 * @returns {boolean} true if the element is within the container, false otherwise
 */
export function isElementInContainer(element, containers) {
    // Prevent errors if element is null/undefined
    if (!element) return false;

    // Convert input to a flat array, filtering out invalid values
    const flatContainers = []
        .concat(containers || [])
        .flatMap((container) => (container instanceof HTMLCollection ? Array.from(container) : container))
        .filter(Boolean);

    // Check if the element is inside any of the containers
    return flatContainers.some((container) =>
        container && typeof container.contains === "function"
            ? element === container || container.contains(element)
            : false
    );
}


/**
 * Handles global wheel events, preventing scroll on all elements except the element
 * @public
 * @param {WheelEvent} e - The wheel event
 * @param {Element} element - The element to check
 * @param {number} [duration=100] - The duration to keep the document body from scrolling
 */
export function handleGlobalWheel(e, element, duration = 100) {
    if (element && !isElementInContainer(e.target, element)) {
        e.preventDefault();
        e.stopPropagation();
        killInertiaScrolling(duration);
    }
}


/**
 * Kills inertia scrolling
 * @private
 * @param {number} [duration=100] - The duration to keep the document body from scrolling
 */
function killInertiaScrolling(duration = 100) {
    document.body.style.overflow = "hidden";
    clearTimeout(window.scrollResetTimer);
    window.scrollResetTimer = setTimeout(() => {
        // Re-enable scrolling after a short delay
        document.body.style.overflow = "";
    }, duration);
}


/**
 * Shows a Unicode clock on the dropzone text
 * @public
 * @param {number} [quarter=1] - The quarter of the clock to show
 */
export function showUnicodeClock(quarter = 1) {
    const sanitizedQuarter = quarter % 4;
    console.log("showUnicodeClock", quarter);
    const dropzoneText = document.getElementById("dropzone-text");
    dropzoneText.classList.remove(
        "dropzone-text-loading-text",
        "dropzone-text-loading-text-1",
        "dropzone-text-loading-text-2",
        "dropzone-text-loading-text-3",
        "dropzone-text-loading-text-4"
    );
    dropzoneText.classList.add(`dropzone-text-loading-text-${sanitizedQuarter}`);
}


/**
 * Gets the scroll position of the book content
 * @public
 * @returns {number} The scroll position of the book content
 */
export function getScrollY() {
    if (typeof window.scrollY === "number") {
        return window.scrollY || document.documentElement.scrollTop;
    } else if (typeof window.__scrollY__ === "function") {
        return window.__scrollY__();
    } else {
        return document.documentElement.scrollTop || 0;
    }
}


/**
 * Creates a stylesheet element
 * @public
 * @param {string} href - The href of the stylesheet
 * @returns {HTMLLinkElement} The created stylesheet element, or the existing stylesheet element if it already exists
 */
export function createStylesheet(href) {
    // Check if the stylesheet already exists, if so, return it
    const fileName = href.split("/").pop();
    const existingStylesheet = getStylesheet(fileName);
    if (existingStylesheet) {
        return existingStylesheet;
    }

    // Create the stylesheet element
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.crossOrigin = "anonymous";
    document.head.appendChild(link);
    return link;
}


/**
 * Retrieves the stylesheet object for a given name
 * @param {string} name - The name of the stylesheet to retrieve
 * @returns {CSSStyleSheet | null} The stylesheet object, or null if not found.
 */
export function getStylesheet(name = "variables.css") {
    for (const sheet of document.styleSheets) {
        try {
            if (sheet.href && sheet.href.includes(name)) {
                return sheet;
            }
        } catch (e) {
            console.warn("Cannot access stylesheet:", sheet.href, e);
        }
    }
    return null;
}
