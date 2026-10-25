import { test } from "node:test";
import assert from "node:assert/strict";
import { createFrameScheduler, startBackgroundTask, withFontDeadline } from "../client/src/core/background-tasks.js";

test("font work with pending requests does not block its caller or core-ready notifications", async () => {
    const order = ["core-listeners-ready"];
    let finish;
    const pending = new Promise((resolve) => { finish = resolve; });
    const task = startBackgroundTask(async () => { order.push("fonts-started"); await pending; order.push("fonts-finished"); });
    order.push("reader-ready"); await Promise.resolve();
    assert.deepEqual(order, ["core-listeners-ready", "reader-ready", "fonts-started"]);
    finish(); await task; assert.equal(order.at(-1), "fonts-finished");
});
test("background failures are handled without rejecting startup", async () => {
    const errors = [];
    await startBackgroundTask(() => { throw new Error("font error"); }, (error) => errors.push(error.message));
    assert.deepEqual(errors, ["font error"]);
});
test("multiple font completions schedule one notification per frame", () => {
    const frames = []; let count = 0;
    const notify = createFrameScheduler(() => { count++; }, (callback) => frames.push(callback));
    notify(); notify(); notify(); assert.equal(frames.length, 1);
    frames.shift()(); assert.equal(count, 1);
    notify(); assert.equal(frames.length, 1); frames.shift()(); assert.equal(count, 2);
});
test("font waiting state has a deadline and completed fonts stay successful", async () => {
    await assert.rejects(withFontDeadline(new Promise(() => {}), 5), /timed out/);
    assert.equal(await withFontDeadline(Promise.resolve("ready"), 5), "ready");
});
