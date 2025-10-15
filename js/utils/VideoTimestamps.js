// js/utils/VideoTimestamps.js

/**
 * Expected JSON structure:
 * {
 *   "creation_time": "2025-10-12T14:39:34Z",
 *   "pts_times": [0.0, 0.033, 0.066, ...]
 * }
 */

export async function loadVideoTimestamps(jsonUrl) {
    console.log("[VideoTimestamps] Loading:", jsonUrl);
    const res = await fetch(jsonUrl);
    if (!res.ok) throw new Error(`Failed to load ${jsonUrl}`);
    const data = await res.json();

    if (!data.creation_time || !Array.isArray(data.pts_times)) {
        throw new Error("Invalid timestamp JSON format");
    }

    if (window.DEBUG) {
        console.log(
            `[VideoTimestamps] Creation time: ${data.creation_time}, Frames: ${data.pts_times.length}`
        );
    }

    return data;
}
