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
            width: 200, height: 200,
            left: "40px", top: "50%", transform: "translateY(-50%)"
        });
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

        if (!this.videoEl) return;
        const tick = () => {
            if (!this.videoEl.paused && !this.videoEl.ended) {
                const t = this.videoEl.currentTime;
                this._updateOverlays(t);
            }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    _updateOverlays() {
        // ask VideoManager for the canonical absolute timestamp (ms)
        const targetMs = this.videoManager.getCurrentVideoTimestampMs();
        if (!targetMs) return;

        // interpolate telemetry for that absolute time
        const point = this.gpxManager.getInterpolatedPoint(targetMs);

        // formatted time shown in UI (derived from same canonical timestamp)
        const formatted = this.videoManager.getVideoTimeFormatted();

        for (const overlay of this.overlays) {
            try { overlay.update(point, formatted, targetMs); }
            catch (err) { console.warn(`[OverlayManager] ${overlay.constructor.name} failed:`, err); }
        }

        this.videoTimeDisplay.textContent = formatted;
    }
}
