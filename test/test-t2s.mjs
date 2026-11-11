import assert from "node:assert/strict";
import { test } from "node:test";
import * as OpenCC from "opencc-js";
import { hooks } from "../client/src/core/hooks.js";
import { readT2SEnabled, registerT2SHook, unregisterT2SHook } from "../client/src/core/t2s.js";
import { _reset } from "../client/src/core/t2s-opencc.js";
const storage = values => ({ getItem: key => values[key] ?? null });
test("old lite/pro preferences preserve off; canonical preference wins", () => {
    for (const [values, expected] of [ [{},true], [{t2s_lite:"false",t2s_pro:"false"},false], [{t2s_lite:"false",t2s_pro:"true"},true], [{t2s_enabled:"false",t2s_pro:"true"},false] ]) {
        assert.equal(readT2SEnabled(storage(values)), expected);
    }
});
test("real offline OpenCC converts all book fields on a copy and preserves resources", async () => {
    globalThis.OpenCC = OpenCC; _reset();
    let enabled = true; registerT2SHook(() => ({enabled}));
    const ctx = {bookData:{metadata:{title:"閱讀",author:"張"}, processedLines:[...Array(21).fill("English introduction"), {content:"頭髮與發展",dropCap:{content:"書"}}, {type:"image",content:'<figure><img src="data:image/png;base64,AAAA" alt="圖片"/><figcaption>閱讀</figcaption></figure>'}], titles:[["閱讀",22,"書"],{text:"閱讀",line:22}],footnotes:[{content:"註釋"}]}};
    const original = structuredClone(ctx);
    try {
        const result = await hooks.run("file:afterProcess",ctx);
        assert.deepEqual(ctx,original);
        assert.equal(result.bookData.processedLines[21].content,"头发与发展");
        assert.equal(result.bookData.metadata.title,"阅读");
        assert.equal(result.bookData.titles[0][2],"书");
        assert.equal(result.bookData.footnotes[0].content,"注释");
        assert.match(result.bookData.processedLines[22].content,/data:image\/png;base64,AAAA/);
        assert.match(result.bookData.processedLines[22].content,/alt="图片"/);
        enabled=false; assert.deepEqual(await hooks.run("file:afterProcess",ctx),original);
    } finally { unregisterT2SHook(); }
});
test("loader failure leaves original data intact", async () => {
    _reset(); delete globalThis.OpenCC;
    registerT2SHook(() => ({enabled:true}));
    const ctx={bookData:{processedLines:["閱讀"]}};
    try { assert.equal(await hooks.run("file:afterProcess",ctx),ctx); }
    finally { unregisterT2SHook(); globalThis.OpenCC=OpenCC; _reset(); }
});
