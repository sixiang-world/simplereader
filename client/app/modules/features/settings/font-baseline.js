/**
 * @fileoverview Font baseline offset computation for the settings module.
 *
 * Extracted verbatim from the original inline `cbReg.add("updateFontBaselineOffsets", ...)`
 * callback in settings.js. The function reads the current title and body font families
 * from CONFIG.RUNTIME_VARS.STYLE, computes per-element vertical/horizontal pixel offsets
 * via getFontOffsets(), and writes the results back to ~20 CSS custom properties.
 *
 * @module client/app/modules/features/settings/font-baseline
 * @requires client/app/config/index
 * @requires client/app/utils/base
 */

import * as CONFIG from "../../../config/index.js";
import { getFontOffsets } from "../../../utils/base.js";

/**
 * Recompute per-element font baseline offsets and write them to
 * CONFIG.RUNTIME_VARS.STYLE as CSS variable values.
 *
 * Side effects:
 *   - Reads CONFIG.RUNTIME_VARS.STYLE.fontFamily_title / fontFamily_body
 *   - Reads CONFIG.RUNTIME_VARS.STYLE.*_fontSize for each title level (toc, h1-h6,
 *     plus h1_fontSize_author for the author byline)
 *   - Reads CONFIG.RUNTIME_VARS.STYLE.p_fontSize / footnote_fontSize for body
 *   - Reads CONFIG.RUNTIME_VARS.FONT_BASELINE_OFFSETS (the precomputed table
 *     fetched from font_baseline_offsets.json on app boot)
 *   - Writes ~20 `*_top` / `*_left` CSS variables back into STYLE
 *
 * Filtering rule: each element is only included if it is truthy. If it is an
 * HTMLElement, it is only included when its id contains "line" or "toc" (for
 * title elements) or just "line" (for body elements). This is the original
 * heuristic — preserved verbatim.
 *
 * @param {Object} ctx - Calling context (the settings singleton), unused but
 *                       kept for signature compatibility with the original
 *                       inline arrow function.
 * @returns {void}
 */
export function updateFontBaselineOffsets(/* ctx */) {
    const elements_title = Object.fromEntries(
        Object.entries({
            toc: CONFIG.RUNTIME_VARS.STYLE.toc_fontSize,
            h1: CONFIG.RUNTIME_VARS.STYLE.h1_fontSize,
            h1Author: CONFIG.RUNTIME_VARS.STYLE.h1_fontSize_author,
            h2: CONFIG.RUNTIME_VARS.STYLE.h2_fontSize,
            h3: CONFIG.RUNTIME_VARS.STYLE.h3_fontSize,
            h4: CONFIG.RUNTIME_VARS.STYLE.h4_fontSize,
            h5: CONFIG.RUNTIME_VARS.STYLE.h5_fontSize,
            h6: CONFIG.RUNTIME_VARS.STYLE.h6_fontSize,
        }).filter(([key, el]) => {
            if (!el) return false;
            if (el instanceof HTMLElement) {
                return el.id.includes("line") || el.id.includes("toc");
            }
            return true;
        })
    );
    const elements_body = Object.fromEntries(
        Object.entries({
            p: CONFIG.RUNTIME_VARS.STYLE.p_fontSize,
            footnote: CONFIG.RUNTIME_VARS.STYLE.footnote_fontSize,
        }).filter(([key, el]) => {
            if (!el) return false;
            if (el instanceof HTMLElement) {
                return el.id.includes("line");
            }
            return true;
        })
    );

    const titleFontOffset = getFontOffsets(
        CONFIG.RUNTIME_VARS.STYLE.fontFamily_title.split(",")[0].trim(),
        elements_title,
        CONFIG.RUNTIME_VARS.FONT_BASELINE_OFFSETS
    );
    const bodyFontOffset = getFontOffsets(
        CONFIG.RUNTIME_VARS.STYLE.fontFamily_body.split(",")[0].trim(),
        elements_body,
        CONFIG.RUNTIME_VARS.FONT_BASELINE_OFFSETS
    );

    CONFIG.RUNTIME_VARS.STYLE.toc_text_span_top = `${titleFontOffset.toc.verticalOffset * -1}${
        titleFontOffset.toc.fontSizeUnit
    }`;
    CONFIG.RUNTIME_VARS.STYLE.toc_text_span_left = `${titleFontOffset.toc.horizontalOffset * -1}${
        titleFontOffset.toc.fontSizeUnit
    }`;
    CONFIG.RUNTIME_VARS.STYLE.h1_top = `${titleFontOffset.h1.verticalOffset * -1}${
        titleFontOffset.h1.fontSizeUnit
    }`;
    CONFIG.RUNTIME_VARS.STYLE.h1_left = `${titleFontOffset.h1.horizontalOffset * -1}${
        titleFontOffset.h1.fontSizeUnit
    }`;
    CONFIG.RUNTIME_VARS.STYLE.h1_author_top = `${titleFontOffset.h1Author.verticalOffset * -1}${
        titleFontOffset.h1Author.fontSizeUnit
    }`;
    CONFIG.RUNTIME_VARS.STYLE.h1_author_left = `${titleFontOffset.h1Author.horizontalOffset * -1}${
        titleFontOffset.h1Author.fontSizeUnit
    }`;
    CONFIG.RUNTIME_VARS.STYLE.h2_top = `${titleFontOffset.h2.verticalOffset * -1}${
        titleFontOffset.h2.fontSizeUnit
    }`;
    CONFIG.RUNTIME_VARS.STYLE.h2_left = `${titleFontOffset.h2.horizontalOffset * -1}${
        titleFontOffset.h2.fontSizeUnit
    }`;
    CONFIG.RUNTIME_VARS.STYLE.h3_top = `${titleFontOffset.h3.verticalOffset * -1}${
        titleFontOffset.h3.fontSizeUnit
    }`;
    CONFIG.RUNTIME_VARS.STYLE.h3_left = `${titleFontOffset.h3.horizontalOffset * -1}${
        titleFontOffset.h3.fontSizeUnit
    }`;
    CONFIG.RUNTIME_VARS.STYLE.h4_top = `${titleFontOffset.h4.verticalOffset * -1}${
        titleFontOffset.h4.fontSizeUnit
    }`;
    CONFIG.RUNTIME_VARS.STYLE.h4_left = `${titleFontOffset.h4.horizontalOffset * -1}${
        titleFontOffset.h4.fontSizeUnit
    }`;
    CONFIG.RUNTIME_VARS.STYLE.h5_top = `${titleFontOffset.h5.verticalOffset * -1}${
        titleFontOffset.h5.fontSizeUnit
    }`;
    CONFIG.RUNTIME_VARS.STYLE.h5_left = `${titleFontOffset.h5.horizontalOffset * -1}${
        titleFontOffset.h5.fontSizeUnit
    }`;
    CONFIG.RUNTIME_VARS.STYLE.h6_top = `${titleFontOffset.h6.verticalOffset * -1}${
        titleFontOffset.h6.fontSizeUnit
    }`;
    CONFIG.RUNTIME_VARS.STYLE.h6_left = `${titleFontOffset.h6.horizontalOffset * -1}${
        titleFontOffset.h6.fontSizeUnit
    }`;
    CONFIG.RUNTIME_VARS.STYLE.p_top = `${bodyFontOffset.p.verticalOffset * -1}${
        bodyFontOffset.p.fontSizeUnit
    }`;
    CONFIG.RUNTIME_VARS.STYLE.p_left = `${bodyFontOffset.p.horizontalOffset * -1}${
        bodyFontOffset.p.fontSizeUnit
    }`;
    CONFIG.RUNTIME_VARS.STYLE.footnote_top = `${bodyFontOffset.footnote.verticalOffset * -1}${
        bodyFontOffset.footnote.fontSizeUnit
    }`;
    CONFIG.RUNTIME_VARS.STYLE.footnote_left = `${bodyFontOffset.footnote.horizontalOffset * -1}${
        bodyFontOffset.footnote.fontSizeUnit
    }`;
}
