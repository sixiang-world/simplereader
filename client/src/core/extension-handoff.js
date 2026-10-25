/** Consume durable handoff only after reader modules are ready. */
export async function consumePendingFile(requestId, send, processFile) {
    let loaded = false;
    try {
        const claim = await send({ action: 'claimPendingFile', requestId });
        if (!claim?.success) throw new Error(claim?.error || 'File handoff unavailable');
        const file = claim.file;
        if (!file || typeof file.fileContent !== 'string' || typeof file.fileName !== 'string' || !file.fileName || file.fileType !== 'text/plain') throw new Error('Invalid pending text file');
        await processFile(file);
        loaded = true;
        const ack = await send({ action: 'ackPendingFile', requestId });
        if (!ack?.success) throw new Error(ack?.error || 'File acknowledgement failed');
        return { status: 'loaded' };
    } catch (error) {
        if (loaded) return { status: 'loaded', error };
        try {
            const restore = await send({ action: 'restorePendingFile', requestId });
            if (restore?.success) return { status: 'restored', error };
        } catch { /* Keep the reader and retry action visible. */ }
        return { status: 'failed', error };
    }
}
