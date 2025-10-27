import { GPXManager } from "./core/GPXManager.js";
import { OverlayManager } from "./core/OverlayManager.js";

// Mapbox GL is loaded globally in flyover.html via a <script> tag.
// We can safely reference it here.
const mapboxgl = window.mapboxgl;

export class FlyoverController {
    constructor(gpx) {
        this.gpx = gpx;
        this.currentGPXTime = gpx.startMs;
        this.currentTime = 0; // seconds since start (simulated)
    }
}

mapboxgl.accessToken = "pk.eyJ1IjoiZWxvcmFjMTgwMyIsImEiOiJjbWg4ZG11ODAwZTk0MmtvbjJ6NTk2ZmFtIn0.O8miJycVl7_hnMInYL0BEQ";

const map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/satellite-streets-v12",
    center: [-104.9903, 39.7392],
    zoom: 13,
    pitch: 45,
    bearing: 0
});

const $ = (sel) => document.querySelector(sel);
const playBtn = $("#playBtn");
const timeEl = $("#gpxTimeDisplay");
const SPEED = 10; // 10× playback speed

function fmtClock(msUtc) {
    const d = new Date(msUtc);
    return d.toLocaleTimeString([], { hour12: false });
}

function bearingBetween(lat1, lon1, lat2, lon2) {
    const toRad = (d) => (d * Math.PI) / 180;
    const toDeg = (r) => (r * 180) / Math.PI;
    const φ1 = toRad(lat1);
    const φ2 = toRad(lat2);
    const λ1 = toRad(lon1);
    const λ2 = toRad(lon2);
    const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
    let θ = toDeg(Math.atan2(y, x));
    if (θ < 0) θ += 360;
    return θ;
}

(async function init() {
    const gpx = new GPXManager();
    await gpx.load("./data/2025-10-26_wahoo.gpx"); // adjust path

    if (!gpx.points?.length) {
        console.error("[flyover] No GPX points loaded.");
        return;
    }

    const p0 = gpx.points[0];
    const map = new mapboxgl.Map({
        container: "map",
        style: "mapbox://styles/mapbox/satellite-streets-v12",
        center: [p0.lon, p0.lat],
        zoom: 15,
        pitch: 60,
        bearing: 0,
        attributionControl: true,
    });

    map.on("load", async () => {
        map.addSource("route", {
            type: "geojson",
            data: {
                type: "Feature",
                geometry: {
                    type: "LineString",
                    coordinates: gpx.points.map((pt) => [pt.lon, pt.lat]),
                },
            },
        });
        map.addLayer({
            id: "route-line",
            type: "line",
            source: "route",
            paint: { "line-color": "#3A9BDC", "line-width": 4 },
        });

        map.addSource("puck", {
            type: "geojson",
            data: { type: "Feature", geometry: { type: "Point", coordinates: [p0.lon, p0.lat] } },
        });

        map.addLayer({
            id: "puck-layer",
            type: "circle",
            source: "puck",
            paint: {
                "circle-radius": 6,
                "circle-color": "#3A9BDC",   // soft blue
                "circle-stroke-color": "#ffffff",
                "circle-stroke-width": 2,
            },
        });

        const overlayContainer = document.getElementById("overlayRoot");
        if (!overlayContainer) {
            console.error("[main] Missing overlayContainer element in HTML");
            return;
        }
        const flyoverController = new FlyoverController(gpx);
        const overlayManager = new OverlayManager(gpx, overlayContainer, null, null, flyoverController);
        await overlayManager.init();
        overlayManager.start();

        setupPlayback(map, gpx, flyoverController, overlayManager);
    });
})();

function setupPlayback(map, gpx, flyoverController, overlayManager) {
    let playing = false;
    let startPerf = 0;
    let startMs = gpx.startMs;
    let raf = null;

    const totalMs = gpx.endMs - gpx.startMs;

    function setBtn(state) {
        playBtn.textContent = state ? "■ Stop" : "▶ Play Flyover";
    }

    function updateFrame(elapsedMs) {
        let gpxMs = startMs + elapsedMs * SPEED;
        if (gpxMs >= gpx.endMs) gpxMs = gpx.endMs;

        const pt = gpx.getInterpolatedPoint(gpxMs);
        if (!pt) return;

        // Update controller state
        flyoverController.currentGPXTime = gpxMs;
        flyoverController.currentTime = (gpxMs - gpx.startMs) / 1000;

        // Update overlays in sync
        overlayManager._updateOverlays();

        const left = gpx.points[Math.max(0, pt.idxLeft - 1)] || gpx.points[pt.idxLeft];
        const right = gpx.points[Math.min(gpx.points.length - 1, pt.idxRight + 1)] || gpx.points[pt.idxRight];
        const brg = bearingBetween(left.lat, left.lon, right.lat, right.lon);

        timeEl.textContent = fmtClock(pt.timeMs ?? gpxMs);

        const puckSrc = map.getSource("puck");
        if (puckSrc) {
            puckSrc.setData({
                type: "Feature",
                geometry: { type: "Point", coordinates: [pt.lon, pt.lat] },
                properties: { bearing: brg },
            });
        }

        map.easeTo({
            center: [pt.lon, pt.lat],
            bearing: brg,
            pitch: 60,
            zoom: 15,
            duration: 0,
        });
    }

    function tick() {
        if (!playing) return;
        const elapsed = performance.now() - startPerf;
        const done = elapsed * SPEED >= totalMs;

        updateFrame(elapsed);

        if (done) {
            playing = false;
            setBtn(false);
            return;
        }
        raf = requestAnimationFrame(tick);
    }

    playBtn.addEventListener("click", () => {
        if (!playing) {
            playing = true;
            startPerf = performance.now();
            startMs = Math.min(startMs, gpx.endMs);
            setBtn(true);
            raf = requestAnimationFrame(tick);
        } else {
            playing = false;
            setBtn(false);
            if (raf) cancelAnimationFrame(raf);
            const elapsed = performance.now() - startPerf;
            startMs = Math.min(gpx.endMs, startMs + elapsed * SPEED);
        }
    });
}