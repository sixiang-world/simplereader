/**
 * @fileoverview Quick jump (go to line) module
 *
 * Provides a dialog for jumping to a specific line number or percentage position.
 * Ported from simplereader-enhance's showGoLine() and adapted for cnb's
 * ES modules architecture.
 *
 * @module client/app/modules/features/go-line
 * @requires client/app/config/index
 * @requires client/app/utils/helpers-reader
 * @requires client/app/modules/features/flow-reader
 */

import * as CONFIG from "../../config/index.js";
import { setHistory } from "../../utils/helpers-reader.js";
import { flowReader } from "./flow-reader.js";

/** @type {HTMLElement|null} The go-line dialog element */
let goLineDlg = null;

/**
 * Go-line module
 * @namespace
 */
export const goLine = {
    /**
     * Show the go-to-line dialog
     */
    showDialog() {
        // Prevent duplicate dialogs
        if (goLineDlg) return;

        goLineDlg = document.createElement("div");
        goLineDlg.id = "goLineDlg";
        goLineDlg.innerHTML = `
            <div class="goline-header">
                <span>快速跳转</span>
                <button class="close-btn" title="关闭 (Esc)">✕</button>
            </div>
            <div class="goline-body">
                <input type="text" class="goline-txt" placeholder="行号 或 百分比（如 50%）" />
                <button class="goline-btn">跳转</button>
            </div>
        `;

        document.body.appendChild(goLineDlg);

        const input = goLineDlg.querySelector(".goline-txt");
        const btnClose = goLineDlg.querySelector(".close-btn");
        const btnGo = goLineDlg.querySelector(".goline-btn");

        // Focus input
        setTimeout(() => input.focus(), 50);

        // Event handlers
        btnClose.addEventListener("click", () => this.close());
        btnGo.addEventListener("click", () => doGo());
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                doGo();
            } else if (e.key === "Escape") {
                e.preventDefault();
                this.close();
            }
        });

        // Store reference to the original onkeydown
        const savedKeydown = document.onkeydown;
        document.onkeydown = (e) => {
            if (e.key === "Escape") {
                this.close();
            }
        };
        goLineDlg._savedKeydown = savedKeydown;
    },

    /**
     * Close the go-line dialog
     */
    close() {
        if (!goLineDlg) return;

        // Restore original keydown handler
        if (goLineDlg._savedKeydown) {
            document.onkeydown = goLineDlg._savedKeydown;
        }

        goLineDlg.remove();
        goLineDlg = null;
    },
};

/**
 * Parse input and navigate to the target position
 */
function doGo() {
    if (!goLineDlg) return;

    const input = goLineDlg.querySelector(".goline-txt");
    const value = input.value.trim();
    if (!value) return;

    const totalLines = CONFIG.VARS.FILE_CONTENT_CHUNKS.length;
    if (totalLines === 0) return;

    let targetLine = 0;

    if (value.endsWith("%")) {
        // Percentage mode
        const percent = parseFloat(value);
        if (isNaN(percent)) return;
        targetLine = Math.round((Math.max(0, Math.min(100, percent)) / 100) * (totalLines - 1));
    } else {
        // Line number mode
        const lineNum = parseInt(value);
        if (isNaN(lineNum)) return;
        targetLine = Math.max(0, Math.min(lineNum, totalLines - 1));
    }

    // Navigate
    if (flowReader.isActive()) {
        flowReader.gotoLine(targetLine, false);
    } else {
        // Page mode: find which page and navigate
        const pageBreaks = CONFIG.VARS.PAGE_BREAKS;
        let targetPage = 1;
        for (let i = 0; i < pageBreaks.length - 1; i++) {
            if (targetLine >= pageBreaks[i] && targetLine < pageBreaks[i + 1]) {
                targetPage = i + 1;
                break;
            }
        }
        if (targetLine >= (pageBreaks[pageBreaks.length - 1] || 0)) {
            targetPage = CONFIG.VARS.TOTAL_PAGES;
        }

        import("./reader.js").then(({ reader }) => {
            if (targetPage !== CONFIG.VARS.CURRENT_PAGE) {
                reader.gotoPage(targetPage, "top");
            }
            const el = CONFIG.DOM_ELEMENT.GET_LINE(targetLine);
            if (el) {
                el.scrollIntoView({ behavior: "instant", block: "start" });
            }
        });
    }

    setHistory(CONFIG.VARS.FILENAME, targetLine);
    goLine.close();
}
