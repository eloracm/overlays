import { OverlayManager } from "./core/OverlayManager.js";
import { VideoManager } from "./core/VideoManager.js";
import { GPXManager } from "./core/GPXManager.js";

window.addEventListener("DOMContentLoaded", async () => {
    const videoElement = document.getElementById("video");
    const overlayContainer = document.getElementById("appContainer");
    if (!overlayContainer) {
        console.error("[main] Missing overlayContainer element in HTML");
        return;
    }

    const gpxManager = new GPXManager();
    await gpxManager.load("data/GX010766_trimmed.gpx");

    const videoManager = new VideoManager("data/GX010766_trimmed.mp4");
    await videoManager.loadMetadata("data/GX010766_meta.json");

    const overlayManager = new OverlayManager(videoElement, overlayContainer, gpxManager, videoManager);
    await overlayManager.init();
    overlayManager.start();

    videoElement.addEventListener("play", () => overlayManager.start());
    videoElement.addEventListener("pause", () => overlayManager.stop());
    videoElement.addEventListener("seeked", () => overlayManager.start());

    window.DEBUG = true;
});
