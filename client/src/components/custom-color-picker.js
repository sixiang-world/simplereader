/**
 * @fileoverview Custom Color Picker implementation using @yaireo/color-picker library
 *
 * @module client/src/modules/components/custom-color-picker
 * @requires client/lib/yaireo/position
 * @requires client/lib/yaireo/color-picker
 */

// Since "@yaireo/position" is used as a script file rather than a Node module (ES export)
position = position.default;

// Get the ColorPicker & some helper functions for color format transformations
const { default: ColorPicker, any_to_hex, changeColorFormat } = window.ColorPicker;

// Module-level registry of live per-input records, shared across wrapper
// instances: repeated getColorPicker() calls never double-attach a picker to
// the same input. Each wrapper owns (and on destroy() releases) only the
// records it created itself.
const liveRecords = new Map();

/**
 * CustomColorPicker class for managing color picker instances
 * @private
 * @class
 * @classdesc Creates and manages color pickers for all elements with 'myColor' class.
 * Features:
 * - Automatic positioning relative to input elements
 * - Swatch management with local storage support
 * - Responsive layout with ResizeObserver
 * - Click-outside handling
 * - Real-time color updates
 * - Multiple color format support (HEX, RGBA, HSLA)
 * - Idempotent initialization and explicit destroy() for full teardown
 * @property {Function} func - Callback function for color changes
 */
class CustomColorPicker {
    /**
     * Creates a new CustomColorPicker instance
     * @constructor
     * @param {Function} func - Callback function to be called when color picker input changes
     * @public
     */
    constructor(callbackOnInput, callbackOnChange) {
        this.callbackOnInput = callbackOnInput;
        this.callbackOnChange = callbackOnChange;
        this._destroyed = false;
        this._owned = new Set();
        this.#init();
    }

    /**
     * Initializes color pickers for all elements with 'myColor' class that are
     * not already managed by a live wrapper (idempotent).
     * @private
     */
    #init() {
        // Iterate all color inputs and instantiate new ColorPicker instances (for each one)
        document.querySelectorAll(".myColor").forEach((colorInput) => {
            if (liveRecords.has(colorInput)) return;

            const record = { colorInput, cPicker: null, resizeObserver: null, intersectionObserver: null };

            const observerCallback = () => {
                if (this._destroyed) return;
                !record.cPicker.DOM.scope.classList.contains("hidden") &&
                    position({
                        target: record.cPicker.DOM.scope,
                        ref: colorInput,
                        placement: colorInput.dataset.placement || "center above",
                        offset: [20],
                    });
            };

            // Create observers to monitor color picker size and visibility changes
            const resizeObserver = new ResizeObserver(observerCallback);
            const intersectionObserver = new IntersectionObserver(observerCallback, {
                root: document,
                threshold: 1,
            });

            // Create a new ColorPicker instance
            const cPicker = new ColorPicker({
                color: colorInput.value, // Accepts formats: HEX(A), RGB(A), HSL(A)
                defaultFormat: "hex",
                swatches: colorInput.dataset.swatches === "false"
                    ? false
                    : colorInput.dataset.swatches
                      ? JSON.parse(colorInput.dataset.swatches)
                      : undefined,
                swatchesLocalStorage: true,

                // When clicking anywhere that is not within the color picker.
                // Use special logic if clicked on the color-input which is
                // assosiacated with this specific picker
                onClickOutside: (e) => {
                    if (this._destroyed) return;
                    let showPicker = false;
                    const isTargetColorInput = e.target === colorInput;
                    const pickerElem = record.cPicker.DOM.scope;

                    if (isTargetColorInput) showPicker = true;
                    if (e.key === "Escape") showPicker = false;

                    // Remove the color-picker from the DOM
                    if (showPicker) this.#showColorPicker(pickerElem);
                    else this.#hideColorPicker(pickerElem);

                    isTargetColorInput && observerCallback();
                },

                // Called when color input changes
                onInput: (c) => {
                    colorInput.value = c;
                    colorInput.style.setProperty("--color", c);
                    requestAnimationFrame(() => {
                        if (this._destroyed) return;
                        this.callbackOnInput();
                    });
                },

                onChange: () => {
                    if (this._destroyed) return;
                    this.callbackOnChange();
                },
            });

            // Set initial position for color picker
            cPicker.DOM.scope.setAttribute("positioned", true);

            record.cPicker = cPicker;

            // Observe document body and color picker changes
            resizeObserver.observe(document.body);
            intersectionObserver.observe(cPicker.DOM.scope);
            observerCallback();

            // Assign a custom property to color-input element
            // which points to the corresponding color-picker instance
            colorInput._colorPicker = cPicker;

            record.resizeObserver = resizeObserver;
            record.intersectionObserver = intersectionObserver;
            liveRecords.set(colorInput, record);
            this._owned.add(record);
        });
    }

    /**
     * Shows the color picker element
     * @param {HTMLElement} pickerElem - The color picker DOM element to show
     * @throws {Error} When pickerElem is null or undefined
     * @fires ColorPicker#show
     * @private
     */
    #showColorPicker(pickerElem) {
        // If picker isn't already in the DOM:
        if (!document.body.contains(pickerElem)) {
            // Inject to DOM
            document.body.appendChild(pickerElem);
        }
    }

    /**
     * Hides the color picker element
     * @param {HTMLElement} pickerElem - The color picker DOM element to hide
     * @fires ColorPicker#hide
     * @private
     */
    #hideColorPicker(pickerElem) {
        pickerElem.remove();
    }

    /**
     * Releases every resource this wrapper created:
     * - disconnects the ResizeObserver / IntersectionObserver pairs
     * - calls the (patched) third-party destroy(), which detaches the
     *   per-instance document.body click and window keydown/storage
     *   listeners — upstream 0.12.0 ships no teardown, so without this
     *   patch those listeners would leak on every settings-menu rebuild
     * - removes any open popup element and clears input back-references
     *
     * Repeated calls are no-ops. Normal settings-menu show/hide must NOT
     * destroy — instances are reused; call this only when the owning DOM is
     * really rebuilt (e.g. SettingsMenu.remove()) or torn down for good.
     *
     * @public
     */
    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        for (const record of this._owned) {
            record.resizeObserver?.disconnect();
            record.intersectionObserver?.disconnect();
            record.cPicker?.DOM?.scope?.remove();
            if (typeof record.cPicker?.destroy === "function") {
                record.cPicker.destroy();
            }
            if (record.colorInput._colorPicker === record.cPicker) {
                delete record.colorInput._colorPicker;
            }
            liveRecords.delete(record.colorInput);
        }
        this._owned.clear();
    }
}

/**
 * Creates and initializes a new CustomColorPicker instance
 * @param {Object} options - Callback functions to be called when color picker input changes
 * @param {Function} options.callbackOnInput - Callback function to be called when color picker input changes
 * @param {Function} options.callbackOnChange - Callback function to be called when color picker input changes
 * @returns {CustomColorPicker} New CustomColorPicker instance
 * @public
 */
export function getColorPicker({ callbackOnInput = () => {}, callbackOnChange = () => {} } = {}) {
    return new CustomColorPicker(callbackOnInput, callbackOnChange);
}
