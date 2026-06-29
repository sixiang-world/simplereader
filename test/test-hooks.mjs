/**
 * Tests for the hook system in client/app/core/hooks.js.
 *
 * The hook system is a typed, ordered, async-aware transform pipeline.
 * These tests cover:
 *   - register / run / unregister basics
 *   - priority ordering (lower runs earlier)
 *   - transform hooks (return mutated context)
 *   - intercept hooks (return false/null to abort)
 *   - once hooks (auto-unregister after one run)
 *   - error isolation (a throwing hook doesn't crash the pipeline)
 *   - undefined return (logged as warning, treated as no-op)
 *
 * The hooks module is environment-agnostic (no DOM, no localStorage),
 * so these tests run in plain Node.js.
 *
 * Run: node test/test-hooks.mjs
 */

import assert from "node:assert/strict";
import { HookRegistry } from "../client/app/core/hooks.js";

let passed = 0;
let failed = 0;
function test(name, fn) {
    return Promise.resolve()
        .then(() => fn())
        .then(() => {
            passed++;
            console.log(`  ✓ ${name}`);
        })
        .catch((err) => {
            failed++;
            console.error(`  ✗ ${name}`);
            console.error(`    ${err.message}`);
        });
}

// Each test gets a fresh registry to avoid cross-test contamination.
function fresh() {
    return new HookRegistry();
}

console.log("core/hooks.js — register / run / unregister\n");

await test("run with no hooks registered → returns initial context unchanged", async () => {
    const h = fresh();
    const result = await h.run("nonexistent", { x: 1 });
    assert.deepEqual(result, { x: 1 });
});

await test("single transform hook → returns its output", async () => {
    const h = fresh();
    h.register("test", (ctx) => ({ ...ctx, touched: true }));
    const result = await h.run("test", { x: 1 });
    assert.deepEqual(result, { x: 1, touched: true });
});

await test("multiple transform hooks run in registration order", async () => {
    const h = fresh();
    const order = [];
    h.register("test", (ctx) => {
        order.push("first");
        return ctx;
    });
    h.register("test", (ctx) => {
        order.push("second");
        return ctx;
    });
    h.register("test", (ctx) => {
        order.push("third");
        return ctx;
    });
    await h.run("test", {});
    assert.deepEqual(order, ["first", "second", "third"]);
});

await test("lower priority runs earlier (priority 50 before 100)", async () => {
    const h = fresh();
    const order = [];
    h.register("test", (ctx) => { order.push("p100"); return ctx; }, { priority: 100 });
    h.register("test", (ctx) => { order.push("p50"); return ctx; }, { priority: 50 });
    h.register("test", (ctx) => { order.push("p75"); return ctx; }, { priority: 75 });
    await h.run("test", {});
    assert.deepEqual(order, ["p50", "p75", "p100"]);
});

await test("context threads through each hook (transform)", async () => {
    const h = fresh();
    h.register("test", (ctx) => ({ ...ctx, step: 1 }));
    h.register("test", (ctx) => ({ ...ctx, step: ctx.step + 1 }));
    h.register("test", (ctx) => ({ ...ctx, step: ctx.step * 10 }));
    const result = await h.run("test", { step: 0 });
    assert.equal(result.step, 20); // (0+1)+1=2, then *10=20
});

await test("intercept hook returning false aborts pipeline", async () => {
    const h = fresh();
    let downstreamRan = false;
    h.register("test", (ctx) => false); // intercept
    h.register("test", (ctx) => {
        downstreamRan = true;
        return ctx;
    });
    const result = await h.run("test", { x: 1 });
    assert.equal(result, null);
    assert.equal(downstreamRan, false);
});

await test("intercept hook returning null aborts pipeline", async () => {
    const h = fresh();
    h.register("test", (ctx) => null);
    const result = await h.run("test", { x: 1 });
    assert.equal(result, null);
});

await test("transform hook returning undefined is treated as no-op (context preserved)", async () => {
    const h = fresh();
    h.register("test", (ctx) => undefined); // bug: forgot to return
    h.register("test", (ctx) => ({ ...ctx, downstream: true }));
    const result = await h.run("test", { x: 1 });
    // The undefined-returning hook is skipped (with a console.warn), the
    // downstream hook still runs, and the original context survives.
    assert.deepEqual(result, { x: 1, downstream: true });
});

await test("once hook auto-unregisters after one run", async () => {
    const h = fresh();
    let count = 0;
    h.register("test", (ctx) => { count++; return ctx; }, { once: true });
    await h.run("test", {});
    await h.run("test", {});
    assert.equal(count, 1);
    assert.equal(h.count("test"), 0);
});

await test("throwing hook is isolated — pipeline continues with previous context", async () => {
    const h = fresh();
    h.register("test", (ctx) => ({ ...ctx, step: 1 }));
    h.register("test", () => {
        throw new Error("boom");
    });
    h.register("test", (ctx) => ({ ...ctx, final: true }));
    const result = await h.run("test", { x: 0 });
    // The throwing hook is skipped; downstream still runs.
    assert.deepEqual(result, { x: 0, step: 1, final: true });
});

await test("unregister by token removes the hook", async () => {
    const h = fresh();
    let count = 0;
    const token = h.register("test", (ctx) => { count++; return ctx; });
    await h.run("test", {});
    assert.equal(count, 1);
    const removed = h.unregister(token);
    assert.equal(removed, true);
    await h.run("test", {});
    assert.equal(count, 1); // not called again
    assert.equal(h.count("test"), 0);
});

await test("unregister with unknown token returns false", () => {
    const h = fresh();
    const removed = h.unregister(Symbol("nope"));
    assert.equal(removed, false);
});

await test("names() lists all registered hook names", () => {
    const h = fresh();
    h.register("a", (ctx) => ctx);
    h.register("b", (ctx) => ctx);
    h.register("c", (ctx) => ctx);
    assert.deepEqual(h.names().sort(), ["a", "b", "c"]);
});

await test("count() returns the number of hooks for a name", () => {
    const h = fresh();
    h.register("test", (ctx) => ctx);
    h.register("test", (ctx) => ctx);
    h.register("test", (ctx) => ctx);
    assert.equal(h.count("test"), 3);
    assert.equal(h.count("nonexistent"), 0);
});

await test("clear() removes all hooks", () => {
    const h = fresh();
    h.register("a", (ctx) => ctx);
    h.register("b", (ctx) => ctx);
    h.clear();
    assert.equal(h.names().length, 0);
});

await test("async hooks are awaited in order", async () => {
    const h = fresh();
    const order = [];
    h.register("test", async (ctx) => {
        await new Promise((r) => setTimeout(r, 30));
        order.push("slow");
        return { ...ctx, slow: true };
    });
    h.register("test", async (ctx) => {
        await new Promise((r) => setTimeout(r, 10));
        order.push("fast");
        return { ...ctx, fast: true };
    });
    const result = await h.run("test", {});
    assert.deepEqual(order, ["slow", "fast"]);
    assert.deepEqual(result, { slow: true, fast: true });
});

// ── Summary ─────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}
