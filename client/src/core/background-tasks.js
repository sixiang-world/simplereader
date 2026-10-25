/** Coalesce notifications within a frame, including multiple font completions. */
export function createFrameScheduler(callback, requestFrame = globalThis.requestAnimationFrame) {
    let scheduled = false;
    return () => {
        if (scheduled) return;
        scheduled = true;
        requestFrame(() => { scheduled = false; callback(); });
    };
}

/** Launch only after the caller's core initialization/listener registration. */
export function startBackgroundTask(task, onError = console.warn) {
    return Promise.resolve().then(task).catch(onError);
}

/** FontFaceSet.load cannot be aborted; bound our UI's waiting state. */
export async function withFontDeadline(promise, timeoutMs = 10000) {
    let timer;
    try {
        return await Promise.race([promise, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("Font load timed out")), timeoutMs);
        })]);
    } finally { clearTimeout(timer); }
}
