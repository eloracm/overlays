import { OverlayManager } from "./core/OverlayManager.js";
import { VideoManager } from "./core/VideoManager.js";
import { GPXManager } from "./core/GPXManager.js";

window.addEventListener("DOMContentLoaded", async () => {
    window.DEBUG = true;

    const overlayContainer = document.getElementById("appContainer");
    if (!overlayContainer) {
        console.error("[main] Missing overlayContainer element in HTML");
        return;
    }

    // Load telemetry and video metadata
    const gpxManager = new GPXManager();
    await gpxManager.load("data/2025-10-12 Cycling.gpx");

    const videoElement = document.getElementById("video");
    const videoManager = new VideoManager(videoElement);
    await videoManager.loadMetadata("data/merged_gpmf_meta.json");

    // 🔹 Compute and apply offset between video and GPX
    // gpxManager.videoToGpxOffsetMs = computeTimeOffset(videoStartMs, gpxStartMs);
    // gpxManager.videoToGpxOffsetMs = 63000;
    const videoDuration = videoManager.getDurationMs();
    const gpxDuration = gpxManager.getDurationMs();
    gpxManager.gpxStartOffsetMs = -8000;

    const scale = (gpxDuration + gpxManager.gpxEndOffsetMs) / videoDuration;

    gpxManager.setTimeScale(scale);

    console.log(
        `[main] Computed videoToGpxOffsetMs = ${gpxManager.gpxStartOffsetMs} ms`
    );

    // Initialize overlays
    const overlayManager = new OverlayManager(videoElement, overlayContainer, gpxManager, videoManager);
    await overlayManager.init();
    overlayManager.start();

    // ▶️ Handle play/pause properly
    videoElement.addEventListener("play", () => {
        console.log("[Video] Playing");
    });
    videoElement.addEventListener("pause", () => {
        console.log("[Video] Paused");
    });
});
