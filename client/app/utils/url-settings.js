/**
 * @fileoverview URL parameter override utilities for settings.
 *
 * Provides schema-driven parsing and type coercion for URL query parameters
 * that temporarily override persistent settings without writing to localStorage.
 *
 * @module client/app/utils/url-settings
 */

import { toBool } from "./base.js";

/**
 * Regex to detect an existing unit suffix on a numeric value.
 * Accepts common CSS units: em, px, %, rem, vh, vw.
 * @type {RegExp}
 */
const UNIT_REGEX = /^[\d.]+(em|px|%|rem|vh|vw)$/i;
const NUMBER_REGEX = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

/**
 * Parses URL query parameters and coerces values to match their declared
 * setting type from SETTINGS_SCHEMA. Non-schema params, hidden settings,
 * and unknown keys are silently ignored.
 *
 * Type coercion rules:
 * - `checkbox` → `toBool(rawVal, false)` → `true` / `false`
 * - `range`    → auto-appends `def.unit` if the raw value lacks a unit suffix
 * - `color`    → passed as raw string (e.g. `"#333333"`)
 * - `select`   → validated against `def.options` when provided, then passed as raw string
 * - `select-font` → passed as raw string (CSS font-family value)
 * - `hidden`   → **skipped** (derived/computed by `getValue`, not URL-overridable)
 *
 * @param {Array<Object>} schema - The SETTINGS_SCHEMA array with `key`, `type`,
 *                                  `hidden`, and `unit` properties per entry.
 * @param {URLSearchParams} urlParams - A `URLSearchParams` instance from
 *                                       `window.location.search`.
 * @returns {Object<string, boolean|string>} A flat object mapping validated
 *          setting keys to properly-typed override values. Returns `{}` when
 *          no relevant URL parameters are present.
 */
export function parseURLSettings(schema, urlParams) {
    const overrides = {};

    // Build a fast key → def lookup
    const defMap = Object.create(null);
    for (let i = 0; i < schema.length; i++) {
        const def = schema[i];
        defMap[def.key] = def;
    }

    for (const [key, rawValue] of urlParams.entries()) {
        const def = defMap[key];
        if (!def) continue;          // Not a settings param
        if (def.hidden) continue;    // Computed/derived — not overridable

        switch (def.type) {
            case "checkbox":
                overrides[key] = rawValue === "" ? false : toBool(rawValue, false);
                break;

            case "range": {
                const trimmed = rawValue.trim();
                // Skip invalid values (must be number or number+unit)
                if (!NUMBER_REGEX.test(trimmed) && !UNIT_REGEX.test(trimmed)) continue;
                // Append unit from schema if the value is unitless
                if (def.unit && NUMBER_REGEX.test(trimmed)) {
                    overrides[key] = trimmed + def.unit;
                } else {
                    overrides[key] = trimmed;
                }
                break;
            }

            case "select":
                // Enforce schema options when available (e.g. ui_language)
                if (Array.isArray(def.options) && def.options.length > 0) {
                    const lowerValue = rawValue.toLowerCase();
                    if (!def.options.some((opt) => opt.toLowerCase() === lowerValue)) continue;
                }
                overrides[key] = rawValue;
                break;

            default:
                // color, select-font, and any future types → raw string
                overrides[key] = rawValue;
                break;
        }
    }

    return overrides;
}
