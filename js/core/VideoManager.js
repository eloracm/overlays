// js/core/VideoManager.js
import { loadVideoTimestamps } from "../utils/VideoTimestamps.js";
import { toLocalDate, formatTime } from "../utils/TimeUtils.js";

export class VideoManager {
    constructor(videoElement) {
        this.video = videoElement;
        this.metadata = null;
        this.frameTimes = [];
        this.creationTime = null;
        this._absoluteMs = 0;
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

    getDurationMs() {
        return this.frameTimes[this.frameTimes.length - 1];
    }

    // VideoManager.js - getCurrentVideoTimestampMs
    getCurrentVideoTimestampMs() {
        if (!this.metadata || !this.creationTime) {
            if (window.DEBUG) console.debug('[VideoManager] metadata/creationTime not ready');
            return null;
        }

        const v = this.video;
        if (!v) return null;

        // raw playback seconds from <video>
        let rawSec = (typeof v.currentTime === 'number' && isFinite(v.currentTime)) ? Math.max(0, v.currentTime) : 0;

        // speed factor (TimeWarp); prefer metadata.speed_factor then fallback to 1
        const speedFactor = (this.metadata && Number(this.metadata.speed_factor)) ? Number(this.metadata.speed_factor) : 1;

        // Apply warp once, centrally — this is the warped video-time in seconds
        const warpedVideoSec = rawSec * speedFactor;

        // Use warpedVideoSec FOR ALL subsequent computations (frame index / proportional mapping)
        // Normalize frame times (cached)
        if (!Array.isArray(this.frameTimes) || this.frameTimes.length === 0) {
            if (window.DEBUG) console.debug('[VideoManager] no frameTimes; fallback using creation + warped elapsed');
            return this.creationTime.getTime() + Math.round(warpedVideoSec * 1000);
        }

        // Build normalized pts array (ms) if needed (cache to _frameTimesNormalized)
        if (!this._frameTimesNormalized || this._frameTimesNormalized.length !== this.frameTimes.length) {
            const nums = this.frameTimes.map(t => {
                const n = Number(t);
                return Number.isFinite(n) ? n : NaN;
            });
            const valid = nums.filter(n => Number.isFinite(n));
            if (valid.length < 2) {
                this._frameTimesNormalized = [];
            } else {
                // determine units by median delta
                const deltas = [];
                for (let i = 1; i < nums.length; i++) {
                    const a = nums[i - 1], b = nums[i];
                    if (Number.isFinite(a) && Number.isFinite(b)) deltas.push(Math.abs(b - a));
                }
                const medianDelta = deltas.length ? deltas.sort((a, b) => a - b)[Math.floor(deltas.length / 2)] : 0;
                const units = (medianDelta > 100) ? 'ms' : 's';
                this._frameTimesNormalized = nums.map(n => Number.isFinite(n) ? (units === 's' ? Math.round(n * 1000) : Math.round(n)) : NaN);
                if (window.DEBUG) console.debug('[VideoManager] normalized pts units=', units, 'medianDelta=', medianDelta);
            }
        }

        const pts = this._frameTimesNormalized || [];
        if (!pts.length) {
            if (window.DEBUG) console.warn('[VideoManager] normalized pts empty');
            return this.creationTime.getTime() + Math.round(warpedVideoSec * 1000);
        }

        // Estimate effective fps from pts if not cached
        if (!this._estimatedFps) {
            const deltas = [];
            for (let i = 1; i < pts.length; i++) {
                const a = pts[i - 1], b = pts[i];
                if (Number.isFinite(a) && Number.isFinite(b)) deltas.push(Math.abs(b - a));
            }
            if (deltas.length) {
                const sd = deltas.sort((a, b) => a - b);
                const medianDeltaMs = sd[Math.floor(sd.length / 2)];
                this._estimatedFps = medianDeltaMs > 0 ? Math.round(1000 / medianDeltaMs) : 30;
            } else {
                this._estimatedFps = 30;
            }
            if (window.DEBUG) console.debug('[VideoManager] estimatedFps=', this._estimatedFps);
        }

        // compute frameIndex using _estimatedFps but based on warpedVideoSec
        const fps = this._estimatedFps || 30;
        let frameIndex = Math.floor(warpedVideoSec * fps);
        if (!Number.isFinite(frameIndex) || isNaN(frameIndex)) frameIndex = 0;
        frameIndex = Math.max(0, Math.min(pts.length - 1, frameIndex));

        const framePtsMs = pts[frameIndex];
        if (!Number.isFinite(framePtsMs)) {
            // fallback: proportional mapping between first and last frame pts
            const first = pts.find(x => Number.isFinite(x));
            let last = null;
            for (let i = pts.length - 1; i >= 0; i--) if (Number.isFinite(pts[i])) { last = pts[i]; break; }
            if (first != null && last != null && last > first) {
                // map warpedVideoSec proportionally into [first,last]
                const videoTotalSec = (this.videoDurationSec || v.duration || (pts.length / fps));
                const prop = Math.min(1, Math.max(0, warpedVideoSec / (videoTotalSec || 1)));
                return this.creationTime.getTime() + Math.round(first + prop * (last - first));
            }
            return this.creationTime.getTime() + Math.round(warpedVideoSec * 1000);
        }

        this._absoluteMs = this.creationTime.getTime() + Math.round(framePtsMs);
        if (window.DEBUG) {
            console.debug('[VideoManager] warped mapping', {
                rawSec, speedFactor, warpedVideoSec, fps, frameIndex, framePtsMs, absoluteMs: this._absoluteMs
            });
        }
        return this._absoluteMs;
    }

    getVideoTimeFormatted() {
        return this._absoluteMs != 0 ? formatTime(new Date(this._absoluteMs)) : "--:--:--";
    }
}
