// js/core/VideoManager.js
import { loadVideoTimestamps } from "../utils/VideoTimestamps.js";
import { toLocalDate, formatTime } from "../utils/TimeUtils.js";

export class VideoManager {
    constructor(videoElement) {
        this.video = videoElement;
        this.metadata = null;
        this.frameTimes = [];
        this.creationTime = null;
    }

    async loadMetadata(jsonUrl) {
        console.log("[VideoManager] Loading video metadata:", jsonUrl);
        try {
            const data = await loadVideoTimestamps(jsonUrl);
            this.metadata = data;
            this.creationTime = toLocalDate(data.creation_time);

            // Prefer corrected timestamps if available (they reflect real-world time)
            const times = data.pts_times_corrected || data.pts_times;
            this.frameTimes = times.map(t => t * 1000); // convert to ms

            if (window.DEBUG) {
                console.log("[VideoManager] Creation time:", this.creationTime);
                console.log("[VideoManager] Loaded", this.frameTimes.length, "frame timestamps");
                if (data.pts_times_corrected) console.log("[VideoManager] Using corrected timestamps");
            }
        } catch (err) {
            console.error("[VideoManager] Failed to load metadata:", err);
        }
    }


    /**
     * Returns the absolute timestamp in ms for the current video position.
     */
    getCurrentVideoTimestampMs() {
        if (!this.frameTimes.length || !this.metadata) return null;
        const frameIndex = Math.min(
            Math.floor(this.video.currentTime * 30),
            this.frameTimes.length - 1
        );
        const creationMs = this.creationTime.getTime();
        return creationMs + this.frameTimes[frameIndex];
    }

    getVideoTimeFormatted() {
        const ts = this.getCurrentVideoTimestampMs();
        return ts ? formatTime(new Date(ts)) : "--:--:--";
    }
}
