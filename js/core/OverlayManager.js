// js/core/OverlayManager.js
import { setupHiDPI } from "../utils/HiDPIUtils.js";
import { SpeedometerOverlay } from "../overlays/SpeedometerOverlay.js";
import { HeartRateOverlay } from "../overlays/HeartRateOverlay.js";
import { ElevationOverlay } from "../overlays/ElevationOverlay.js";
import { MapStaticOverlay } from "../overlays/MapStaticOverlay.js";
import { MapDynamicOverlay } from "../overlays/MapDynamicOverlay.js";

export class OverlayManager {
    constructor(videoEl, overlayContainer, gpxManager, videoManager) {
        this.videoEl = videoEl;
        this.overlayContainer = overlayContainer;
        this.gpxManager = gpxManager;
        this.videoManager = videoManager;
        this.overlays = [];
        this.videoTimeDisplay = document.getElementById("videoTimeDisplay");
        this.lastDisplayedSecond = -1;


        // 🕓 When user scrubs or jumps in video
        this.videoEl.addEventListener("seeked", () => {
            console.log("[Video] Seeked to", this.videoEl.currentTime);
            this._updateOverlays();
        });

        // 🔁 During playback, update overlays continuously
        this.videoEl.addEventListener("timeupdate", () => {
            this._updateOverlays();
        });
        this._setupHiDPIScaling();
    }

    /** Setup 4K internal rendering with scale-to-fit for 1280x720 output */
    _setupHiDPIScaling() {
        const displayW = 1280, displayH = 720;
        const internalW = 3840, internalH = 2160;
        Object.assign(this.overlayContainer.style, {
            position: "relative",
            width: `${displayW}px`,
            height: `${displayH}px`,
            overflow: "hidden",
            background: "black"
        });
        this.overlayContainer.dataset.internalWidth = internalW;
        this.overlayContainer.dataset.internalHeight = internalH;

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
            width: 200, height: 200,
            right: "40px", top: "50%", transform: "translateY(-50%)"
        });

        this.overlays.push(staticMap, dynamicMap, elevation, speedometer, heartRate);
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

        // if (!this.videoEl) return;
        // const tick = () => {
        //     if (!this.videoEl.paused && !this.videoEl.ended) {
        //         const t = this.videoEl.currentTime;
        //         this._updateOverlays(t);
        //     }
        //     requestAnimationFrame(tick);
        // };
        // requestAnimationFrame(tick);
    }

    _updateOverlays() {
        const targetMs = this.videoManager.getCurrentVideoTimestampMs();

        if (!targetMs) {
            console.debug("[OverlayManager] No targetMs yet (videoManager returned null/0)");
            return;
        }
        const formatted = this.videoManager.getVideoTimeFormatted();

        // Get first and last GPX timestamps for reference
        const gpxStart = this.gpxManager.getStartTimestampMs?.() ?? 0;
        const gpxEnd = this.gpxManager.getEndTimestampMs?.() ?? 0;

        console.debug(`[OverlayManager] targeTime = ${formatted} (${targetMs}), GPX range=${gpxStart}–${gpxEnd}`);

        const point = this.gpxManager.getInterpolatedPoint(targetMs);
        if (!point) {
            console.debug(`[OverlayManager] No telemetry point found for ${targetMs} ms`);
        } else {
            console.debug(`[OverlayManager] Found telemetry point at ${point.timeMs || "unknown time"}`);
        }

        for (const overlay of this.overlays) {
            try {
                console.debug(`[OverlayManager] Updating overlay ${overlay.constructor.name} at ${targetMs}`);
                overlay.update(point, targetMs);
            } catch (err) {
                console.warn(`[OverlayManager] ${overlay.constructor.name} failed:`, err);
            }
        }

        this.videoTimeDisplay.textContent = formatted;
    }

}
