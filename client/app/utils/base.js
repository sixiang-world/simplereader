/**
 * @fileoverview Base utility functions (facade).
 *
 * (v2 refactor) The original base.js monolith (1384 lines, 50+ exports)
 * has been split into themed submodules under ./base/. This file is now
 * a thin facade that re-exports everything, so existing imports like
 *
 *     import { toBool, hexToHSL } from "../../utils/base.js";
 *
 * continue to work unchanged. New code is encouraged to import directly
 * from the relevant submodule for tree-shaking and clarity:
 *
 *     import { toBool } from "../../utils/base/toBool.js";
 *     import { hexToHSL } from "../../utils/base/color.js";
 *
 * @module client/app/utils/base
 */

export * from "./base/color.js";
export * from "./base/env.js";
export * from "./base/font.js";
export * from "./base/fetch.js";
export * from "./base/format.js";
export * from "./base/dom.js";
export * from "./base/func.js";
export * from "./base/path.js";
export * from "./base/toBool.js";
