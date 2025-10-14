// VideoTimestamps.js
// Loads preprocessed video metadata from <video>_meta.json
// and expands frame times into absolute timestamps.

export async function loadVideoMeta(videoPath) {
    const metaPath = videoPath.replace(/\.mp4$/i, "_meta.json");
    console.log(`[VideoTimestamps] Loading: ${metaPath}`);

    try {
        const res = await fetch(metaPath);
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        const meta = await res.json();

        if (!meta.creation_time || !Array.isArray(meta.pts_times)) {
            throw new Error("Invalid metadata format (missing creation_time or pts_times)");
        }

        // Interpret creation_time as local time if it has no timezone
        let creationMs;
        if (/Z|[+-]\d\d:?(\d\d)?$/.test(meta.creation_time)) {
            // has explicit timezone → parse normally
            creationMs = new Date(meta.creation_time).getTime();
        } else {
            // treat as local (not UTC)
            const parts = meta.creation_time.match(/\d+/g);
            if (parts && parts.length >= 6) {
                const [Y, M, D, h, m, s] = parts.map(Number);
                creationMs = new Date(Y, M - 1, D, h, m, s).getTime();
            } else {
                creationMs = Date.now();
            }
        }

        if (isNaN(creationMs)) throw new Error("Invalid creation_time date");

        const frameTimesMs = meta.pts_times.map(t => creationMs + t * 1000);
        console.log(`[VideoTimestamps] ${meta.file}: ${frameTimesMs.length} frames, start ${meta.creation_time}`);

        return {
            file: meta.file,
            creationTime: meta.creation_time,
            creationMs,
            frameTimesMs,
            duration: meta.duration,
            frameRate: meta.frame_rate,
            width: meta.width,
            height: meta.height,
        };
    } catch (err) {
        console.error("[VideoTimestamps] Failed to load metadata:", err);
        throw err;
    }
}
