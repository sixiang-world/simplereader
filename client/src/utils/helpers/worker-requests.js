// @ts-check
/** A bounded request dispatcher owned by one Worker. No business logic lives here. */
export class WorkerRequests {
    /** @type {Map<number, {resolve: Function, reject: Function, cleanup: Function, progress?: Function}>} */
    pending = new Map();
    nextId = 0;
    /** @type {Error|null} */
    failure = null;
    /** @param {Worker} worker */
    constructor(worker) {
        this.worker = worker;
        this.onMessage = (event) => {
            const message = event.data;
            const entry = this.pending.get(message?.id);
            if (!entry) return;
            if (message.type === 'processingProgress') { entry.progress?.(message); return; }
            entry.cleanup();
            if (message.type === 'error') entry.reject(new Error(message.error || 'Worker request failed'));
            else entry.resolve(message);
        };
        this.onError = (event) => this.fail(new Error(event.message || 'Worker communication failed'));
        worker.addEventListener('message', this.onMessage);
        worker.addEventListener('error', this.onError);
        worker.addEventListener('messageerror', this.onError);
    }
    /** @param {object} payload @param {{signal?: AbortSignal, timeoutMs?: number, progress?: Function}} options */
    request(payload, { signal, timeoutMs = 120000, progress } = {}) {
        if (this.failure) return Promise.reject(this.failure);
        if (signal?.aborted) return Promise.reject(signal.reason || new DOMException('Cancelled', 'AbortError'));
        return new Promise((resolve, reject) => {
            const id = ++this.nextId;
            const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); this.pending.delete(id); };
            const abort = () => { cleanup(); reject(signal.reason || new DOMException('Cancelled', 'AbortError')); };
            const timer = setTimeout(() => { cleanup(); reject(new Error('Worker request timed out')); }, timeoutMs);
            this.pending.set(id, { resolve, reject, cleanup, progress });
            signal?.addEventListener('abort', abort, { once: true });
            try { this.worker.postMessage({ ...payload, id }); }
            catch (error) { cleanup(); reject(error); }
        });
    }
    /** @param {Error} error */
    fail(error) {
        this.failure = error;
        for (const entry of this.pending.values()) { entry.cleanup(); entry.reject(error); }
    }
    dispose() {
        this.fail(new Error('Worker disposed'));
        this.worker.removeEventListener('message', this.onMessage);
        this.worker.removeEventListener('error', this.onError);
        this.worker.removeEventListener('messageerror', this.onError);
        this.worker.terminate();
    }
}
