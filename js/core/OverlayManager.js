// js/core/OverlayManager.js
import { SpeedometerOverlay } from "../overlays/SpeedometerOverlay.js";
import { HeartRateOverlay } from "../overlays/HeartRateOverlay.js";
import { ElevationOverlay } from "../overlays/ElevationOverlay.js";
import { MapStaticOverlay } from "../overlays/MapStaticOverlay.js";
import { MapDynamicOverlay } from "../overlays/MapDynamicOverlay.js";
import { SlopeOverlay } from "../overlays/SlopeOverlay.js";
import { formatTime } from "../utils/TimeUtils.js";

export class OverlayManager {
    constructor(gpxManager, overlayContainer, videoEl, videoManager, flyoverController) {
        this.gpxManager = gpxManager;
        this.overlayContainer = overlayContainer;
        this.videoElement = videoEl;
        this.videoManager = videoManager;
        this.flyoverController = flyoverController;
        this.overlays = [];
        this.videoTimeDisplay = document.getElementById("videoTimeDisplay");
        this.lastDisplayedSecond = -1;
        this.isPlaying = false;
        this.rafId = null;
        this.lastVideoTime = 0;

        if (videoEl) {
            // 🕓 When user scrubs or jumps in video
            this.videoElement.addEventListener("seeked", () => {
                console.log("[Video] Seeked to", this.videoElement.currentTime);
                this._updateOverlays();
            });
            videoEl.addEventListener("play", () => this.startAnimation());
            videoEl.addEventListener("pause", () => this.stopAnimation());
            videoEl.addEventListener("ended", () => this.stopAnimation());
        }

    }

    getCurrentTime() {
        if (this.videoElement) return this.videoElement.currentTime;
        if (this.flyoverController) return this.flyoverController.currentTime;
        return 0;
    }

    /**
 * Return current GPX timestamp (in ms) from the appropriate source
 */
    getCurrentGPXTime() {
        if (this.videoManager && typeof this.videoManager.getCurrentVideoTimestampMs === "function") {
            return this.videoManager.getCurrentVideoTimestampMs();
        }
        if (this.flyoverController) return this.flyoverController.currentGPXTime;
        return null;
    }

    /** Initialize overlays — static DOM ones + dynamic overlays */
    async init() {
        // Predefined overlays
        const staticMap = new MapStaticOverlay("mapStatic", this.gpxManager); // constructor calls _initMap itself
        const dynamicMap = new MapDynamicOverlay("mapDynamic", this.gpxManager);
        const elevation = new ElevationOverlay("elevationCanvas", this.gpxManager);
        if (this.gpxManager.points?.length)
            dynamicMap.init(this.gpxManager.points[0].lat, this.gpxManager.points[0].lon);

        // Dynamic overlays
        const speedometer = new SpeedometerOverlay(this.overlayContainer, {
            width: 240,
            height: 150,
            maxMph: this.gpxManager.suggestedMaxMph || 40
        }, this.gpxManager, this.videoManager);


        const heartRate = new HeartRateOverlay(this.overlayContainer, {
            width: 100, height: 100,
            right: "40px", top: "50%", transform: "translateY(-50%)"
        });

        const slopeOverlay = new SlopeOverlay(this.overlayContainer, { left: "50px", bottom: "250px" }, this.gpxManager);

        this.overlays.push(staticMap, dynamicMap, elevation, speedometer, heartRate, slopeOverlay);
        console.log(`[OverlayManager] Initialized ${this.overlays.length} overlays`);
    }

    /** Main loop */
    start() {
        // Force initial render before playback starts
        const initialPoint = this.gpxManager.points?.[0];
        if (initialPoint) {
            this.overlays.forEach(o => {
                if (typeof o.update === "function") {
                    o.update(initialPoint, initialPoint.time);
                }
            });
        }

    }

    startAnimation() {
        if (this.isPlaying) return;
        this.isPlaying = true;

        const animate = () => {
            if (!this.isPlaying) return;

            const video = this.videoManager.video;
            const timeMs = video.currentTime * 1000;

            // Only update if time is advancing or we’re scrubbing
            if (Math.abs(timeMs - this.lastVideoTime) > 0.1) {
                this._updateOverlays();
                this.lastVideoTime = timeMs;
            }

            this.rafId = requestAnimationFrame(animate);
        };

        this.rafId = requestAnimationFrame(animate);
    }

    stopAnimation() {
        this.isPlaying = false;
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.rafId = null;
    }

    _updateOverlays() {
        const targetMs = this.getCurrentGPXTime();

        if (!targetMs) {
            console.debug("[OverlayManager] No targetMs yet (videoManager returned null/0)");
            return;
        }
        const formatted = this.getCurrentTime();

        // Get first and last GPX timestamps for reference
        const gpxStart = this.gpxManager.startMs;
        const gpxEnd = this.gpxManager.endMs;

        console.debug(`[OverlayManager] targetTime = ${formatted} (${targetMs}), GPX range=${gpxStart}–${gpxEnd}`);

        const point = this.gpxManager.getInterpolatedPoint(targetMs);
        if (!point) {
            console.debug(`[OverlayManager] No telemetry point found for ${targetMs} ms`);
        } else {
            console.debug(`[OverlayManager] Found telemetry point at ${point.timeMs || "unknown time"} ${point.timeMs ? formatTime(new Date(point.timeMs)) : ''})`);
        }

        for (const overlay of this.overlays) {
            try {
                // console.debug(`[OverlayManager] Updating overlay ${overlay.constructor.name} at ${targetMs}`);
                overlay.update(point, targetMs);
            } catch (err) {
                console.warn(`[OverlayManager] ${overlay.constructor.name} failed:`, err);
            }
        }

        // this.videoTimeDisplay.textContent = formatted;
    }

}
