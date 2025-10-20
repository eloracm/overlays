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
    await gpxManager.load("data/GX010766_combined_gpmf_gps.gpx");

    const videoElement = document.getElementById("video");
    const videoManager = new VideoManager(videoElement);
    await videoManager.loadMetadata("data/GX010766_combined_gpmf_meta.json");

    // 🔹 Compute and apply offset between video and GPX
    const videoStartMs = videoManager.creationTime.getTime();
    const gpxStartMs = gpxManager.startMs;
    // gpxManager.videoToGpxOffsetMs = computeTimeOffset(videoStartMs, gpxStartMs);
    // gpxManager.videoToGpxOffsetMs = 63000;
    gpxManager.videoToGpxOffsetMs = 500;

    console.log(
        `[main] Computed videoToGpxOffsetMs = ${gpxManager.videoToGpxOffsetMs} ms`
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
