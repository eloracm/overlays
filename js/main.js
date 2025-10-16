import { OverlayManager } from "./core/OverlayManager.js";
import { VideoManager } from "./core/VideoManager.js";
import { GPXManager } from "./core/GPXManager.js";
import { computeTimeOffset } from "./utils/TimeUtils.js";

window.addEventListener("DOMContentLoaded", async () => {
    window.DEBUG = true;

    const overlayContainer = document.getElementById("appContainer");
    if (!overlayContainer) {
        console.error("[main] Missing overlayContainer element in HTML");
        return;
    }

    // Load telemetry and video metadata
    const gpxManager = new GPXManager();
    await gpxManager.load("data/GX010766_trimmed.gpx");

    const videoElement = document.getElementById("video");
    const videoManager = new VideoManager(videoElement);
    await videoManager.loadMetadata("data/GX010766_meta.json");

    // 🔹 Compute and apply offset between video and GPX
    const videoStartMs = videoManager.creationTime.getTime();
    const gpxStartMs = gpxManager.startMs;
    // gpxManager.videoToGpxOffsetMs = computeTimeOffset(videoStartMs, gpxStartMs);
    gpxManager.videoToGpxOffsetMs = 63000;

    console.log(
        `[main] Computed videoToGpxOffsetMs = ${gpxManager.videoToGpxOffsetMs} ms`
    );

    // Initialize overlays
    const overlayManager = new OverlayManager(videoElement, overlayContainer, gpxManager, videoManager);
    await overlayManager.init();
    overlayManager.start();

    videoElement.addEventListener("play", () => overlayManager.start());
    videoElement.addEventListener("pause", () => overlayManager.stop());
    videoElement.addEventListener("seeked", () => overlayManager.start());
});
