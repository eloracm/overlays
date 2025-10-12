// overlays.js
// Full overlays + recording + ffmpeg.wasm conversion to MP4
// This file replaces the recording parts in your previous overlays.js and
// retains your GPX/map/overlay logic.

(async () => {
    // -------------------- BASIC DOM + MAP SETUP --------------------
    const video = document.getElementById("video");
    const canvas = document.getElementById("overlay");
    const ctx = canvas.getContext("2d");

    let points = [];
    let marker;
    let traveledLine;
    let gpxStartMs, gpxEndMs, gpxDurationMs;
    let maxSpeed = 0;
    let minEle = 0, maxEle = 0;
    let totalMiles = 0;

    const map = L.map("map").setView([0, 0], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);

    // After map loads or after resizing:
    setTimeout(() => {
        map.invalidateSize();
        console.log("✅ Leaflet size recalculated:", document.getElementById("map").offsetWidth, "x", document.getElementById("map").offsetHeight);
    }, 300);

    // -------------------- GPX LOADER (your existing logic) --------------------
    async function loadGPX(url) {
        const res = await fetch(url);
        const text = await res.text();

        const parser = new GPXParser();
        parser.parse(text);
        const track = parser.tracks[0];
        if (!track || !track.points || track.points.length === 0) {
            console.error("No GPX track points found!");
            return;
        }

        points = track.points
            .map(p => ({
                lat: parseFloat(p.lat),
                lon: parseFloat(p.lon),
                ele: parseFloat(p.ele) || 0,
                time: p.time ? new Date(p.time) : null,
                hr: p.heartRateBpm != null ? parseFloat(p.heartRateBpm) : null
            }))
            .filter(p => !isNaN(p.lat) && !isNaN(p.lon) && p.time instanceof Date && !isNaN(p.time));

        if (points.length < 2) {
            console.error("Not enough valid GPX points with time data.");
            return;
        }

        // Fill missing HR from previous point
        for (let i = 1; i < points.length; i++) {
            if (points[i].hr == null && points[i - 1].hr != null) {
                points[i].hr = points[i - 1].hr;
            }
        }

        // Compute distances, cumulative miles, speeds
        let cumulativeDist = 0;
        points[0].cumMiles = 0;
        points[0].speedMph = 0;
        for (let i = 1; i < points.length; i++) {
            const a = points[i - 1], b = points[i];
            const dMeters = haversineMeters(a, b);
            const dt = (b.time - a.time) / 1000;
            cumulativeDist += dMeters;
            b.cumMiles = cumulativeDist / 1609.34;
            b.speedMph = dt > 0 ? (dMeters / dt) * 2.23694 : a.speedMph;
        }

        // Adaptive smoothing (same as your logic)
        const smoothSpeed = (i, window) => {
            const start = Math.max(0, i - window);
            const end = Math.min(points.length - 1, i + window);
            let sum = 0, count = 0;
            for (let j = start; j <= end; j++) {
                if (!isNaN(points[j].speedMph)) { sum += points[j].speedMph; count++; }
            }
            return count > 0 ? sum / count : points[i].speedMph;
        };
        for (let i = 0; i < points.length; i++) {
            const s = points[i].speedMph;
            let window = 3;
            if (s < 5) window = 6;
            else if (s < 10) window = 4;
            else if (s < 20) window = 3;
            else if (s < 30) window = 2;
            else window = 1;
            points[i].speedMph = smoothSpeed(i, window);
        }

        minEle = Math.min(...points.map(p => p.ele));
        maxEle = Math.max(...points.map(p => p.ele));
        maxSpeed = Math.ceil(Math.max(...points.map(p => p.speedMph)) / 10) * 10 || 10;
        gpxStartMs = points[0].time.getTime();
        gpxEndMs = points[points.length - 1].time.getTime();
        gpxDurationMs = gpxEndMs - gpxStartMs;

        // Video↔GPX time mapping
        window.gpxSync = {
            gpxStartMs,
            gpxEndMs,
            gpxDurationMs,
            videoStartMs: 0,          // assume video t=0 aligns to gpxStartMs
            videoEndMs: 0,            // we’ll fill this after video metadata loads
            offsetMs: 0               // manual fine-tune if needed
        };
        video.addEventListener("loadedmetadata", () => {
            window.gpxSync.videoEndMs = video.duration * 1000;
        });

        const latlngs = points.map(p => [p.lat, p.lon]);
        L.polyline(latlngs, { color: "gray", weight: 3 }).addTo(map);
        window.baseRoute = L.polyline(latlngs, { color: "#777", weight: 4, opacity: 0.4 }).addTo(map);
        traveledLine = L.polyline([], { color: "blue", weight: 3 }).addTo(map);
        map.fitBounds(latlngs);
        marker = L.circleMarker(latlngs[0], { radius: 5, color: "red" }).addTo(map);

        totalMiles = points[points.length - 1].cumMiles;
        console.log(`Loaded ${points.length} points. Distance: ${totalMiles.toFixed(2)} mi`);
    }

    // -------------------- HELPERS --------------------
    function haversineMeters(a, b) {
        const R = 6371000;
        const dLat = (b.lat - a.lat) * Math.PI / 180;
        const dLon = (b.lon - a.lon) * Math.PI / 180;
        const lat1 = a.lat * Math.PI / 180;
        const lat2 = b.lat * Math.PI / 180;
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }

    function getInterpolatedPoint(currentTime) {
        if (!points || points.length < 2) return points[0];

        const { gpxStartMs, gpxEndMs, gpxDurationMs, offsetMs } = window.gpxSync || {};
        const videoTimeMs = currentTime * 1000 + (offsetMs || 0);

        // Map current video time → GPX time
        const targetTime = gpxStartMs + (videoTimeMs / (video.duration * 1000)) * gpxDurationMs;

        // Find the two GPX points surrounding targetTime (binary search)
        let left = 0, right = points.length - 1;
        while (left < right - 1) {
            const mid = (left + right) >> 1;
            if (points[mid].time.getTime() < targetTime) left = mid;
            else right = mid;
        }

        const a = points[left];
        const b = points[right];
        const t1 = a.time.getTime();
        const t2 = b.time.getTime();

        if (t2 <= t1) return a; // no progress

        const ratio = (targetTime - t1) / (t2 - t1);

        // Interpolate all numeric fields
        const lerp = (v1, v2) => v1 + (v2 - v1) * ratio;

        return {
            lat: lerp(a.lat, b.lat),
            lon: lerp(a.lon, b.lon),
            speed: lerp(a.speedMph, b.speedMph),
            ele: lerp(a.ele, b.ele),
            miles: lerp(a.cumMiles, b.cumMiles)
        };
    }

    // -------------------- DRAWING FUNCTIONS (speedometer/elevation/heart text) --------------------
    // (These mirror your original code; they remained unchanged.)
    function drawSpeedometer(speed) {
        const cx = canvas.width - 150;
        const cy = 100;
        const r = 80;
        const minAngle = Math.PI, maxAngle = 2 * Math.PI;
        const safeSpeed = Math.min(speed, maxSpeed);
        const angle = minAngle + (safeSpeed / maxSpeed) * (maxAngle - minAngle);

        // Arc background
        ctx.beginPath();
        ctx.arc(cx, cy, r, minAngle, maxAngle);
        ctx.strokeStyle = "#333";
        ctx.lineWidth = 8;
        ctx.stroke();

        // Tick marks
        for (let s = 0; s <= maxSpeed; s += maxSpeed / 6) {
            const tickAngle = minAngle + (s / maxSpeed) * (maxAngle - minAngle);
            const x1 = cx + Math.cos(tickAngle) * (r - 8);
            const y1 = cy + Math.sin(tickAngle) * (r - 8);
            const x2 = cx + Math.cos(tickAngle) * r;
            const y2 = cy + Math.sin(tickAngle) * r;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.strokeStyle = "#888";
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // Needle
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(angle) * (r - 15), cy + Math.sin(angle) * (r - 15));
        ctx.strokeStyle = "red";
        ctx.lineWidth = 3;
        ctx.stroke();

        // Center cap
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, 2 * Math.PI);
        ctx.fillStyle = "red";
        ctx.fill();

        // Speed text
        ctx.fillStyle = "white";
        ctx.font = "bold 24px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`${safeSpeed.toFixed(1)} mph`, cx, cy + 50);
    }

    function drawElevationProfile(currentTime) {
        const margin = 60;
        const chartHeight = 150;
        const graphBottom = canvas.height - 30;
        const graphTop = graphBottom - chartHeight;
        const graphLeft = margin;
        const graphRight = canvas.width - margin;

        const totalMilesSafe = totalMiles && totalMiles > 0 ? totalMiles : 1;
        const minEleFt = minEle * 3.28084;
        const maxEleFt = maxEle * 3.28084;
        const eleRangeFt = (maxEleFt - minEleFt) || 1;

        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
            const x = graphLeft + (points[i].cumMiles / totalMilesSafe) * (graphRight - graphLeft);
            const eleFt = points[i].ele * 3.28084;
            const y = graphBottom - ((eleFt - minEleFt) / eleRangeFt) * chartHeight;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.lineTo(graphRight, graphBottom);
        ctx.lineTo(graphLeft, graphBottom);
        ctx.closePath();

        ctx.fillStyle = "rgba(0,188,212,0.35)";
        ctx.fill();

        // Draw slope-colored line segments on top
        for (let i = 1; i < points.length; i++) {
            const prev = points[i - 1], curr = points[i];
            const distMeters = (curr.cumMiles - prev.cumMiles) * 1609.34;
            const elevChangeMeters = curr.ele - prev.ele;
            const slopePct = distMeters > 0 ? (elevChangeMeters / distMeters) * 100 : 0;

            let color;
            if (slopePct < -3) color = "#00ff88";
            else if (slopePct < 1) color = "#ffff66";
            else if (slopePct < 5) color = "#ff9933";
            else color = "#ff3333";

            const x1 = graphLeft + (prev.cumMiles / totalMilesSafe) * (graphRight - graphLeft);
            const y1 = graphBottom - (((prev.ele * 3.28084) - minEleFt) / eleRangeFt) * chartHeight;
            const x2 = graphLeft + (curr.cumMiles / totalMilesSafe) * (graphRight - graphLeft);
            const y2 = graphBottom - (((curr.ele * 3.28084) - minEleFt) / eleRangeFt) * chartHeight;

            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // Axes & ticks (keeps your original implementation)
        ctx.strokeStyle = "#999";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(graphLeft, graphBottom);
        ctx.lineTo(graphRight, graphBottom);
        ctx.moveTo(graphLeft, graphBottom);
        ctx.lineTo(graphLeft, graphTop);
        ctx.stroke();

        ctx.fillStyle = "#ccc";
        ctx.font = "12px sans-serif";
        ctx.textAlign = "center";
        const xTicks = 5;
        for (let i = 0; i <= xTicks; i++) {
            const ratio = i / xTicks;
            const x = graphLeft + ratio * (graphRight - graphLeft);
            const miles = totalMilesSafe * ratio;
            ctx.beginPath();
            ctx.moveTo(x, graphBottom);
            ctx.lineTo(x, graphBottom + 5);
            ctx.stroke();
            ctx.fillText(miles.toFixed(1), x, graphBottom + 18);
        }
        ctx.textAlign = "right";
        ctx.fillText("Distance (mi)", graphRight, graphBottom + 35);

        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        const yTicks = 5;
        for (let i = 0; i <= yTicks; i++) {
            const ratio = i / yTicks;
            const y = graphBottom - ratio * chartHeight;
            const eleFt = minEleFt + ratio * (maxEleFt - minEleFt);
            ctx.beginPath();
            ctx.moveTo(graphLeft - 5, y);
            ctx.lineTo(graphLeft, y);
            ctx.stroke();
            ctx.fillText(Math.round(eleFt), graphLeft - 10, y);
        }
        ctx.textBaseline = "bottom";
        ctx.fillText("Elevation (ft)", graphLeft + 10, graphTop - 10);

        // Progress marker and tooltip
        const p = getInterpolatedPoint(currentTime);
        const markerX = graphLeft + (p.miles / totalMilesSafe) * (graphRight - graphLeft);
        const markerY = graphBottom - (((p.ele * 3.28084) - minEleFt) / eleRangeFt) * chartHeight;
        ctx.beginPath();
        ctx.arc(markerX, markerY, 5, 0, 2 * Math.PI);
        ctx.fillStyle = "red";
        ctx.fill();

        let currentSlopePct = 0;
        for (let i = 1; i < points.length; i++) {
            if (p.miles >= points[i - 1].cumMiles && p.miles <= points[i].cumMiles) {
                const distMeters = (points[i].cumMiles - points[i - 1].cumMiles) * 1609.34;
                const elevChangeMeters = points[i].ele - points[i - 1].ele;
                currentSlopePct = distMeters > 0 ? (elevChangeMeters / distMeters) * 100 : 0;
                break;
            }
        }

        const tooltipText = `Elevation: ${Math.round(p.ele * 3.28084)} ft   Slope: ${currentSlopePct >= 0 ? "+" : ""}${currentSlopePct.toFixed(1)}%`;
        ctx.font = "14px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        const textWidth = ctx.measureText(tooltipText).width + 12;
        const tooltipX = Math.min(Math.max(markerX, graphLeft + textWidth / 2), graphRight - textWidth / 2);
        const tooltipY = markerY - 15;
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.fillRect(tooltipX - textWidth / 2, tooltipY - 22, textWidth, 22);
        ctx.fillStyle = "#fff";
        ctx.fillText(tooltipText, tooltipX, tooltipY - 5);
    }

    function updateHeartRateOverlay(currentTime) {
        if (!points || points.length < 2) return;

        const targetTime = gpxStartMs + (currentTime / video.duration) * gpxDurationMs;
        let closest = points[0];
        let minDiff = Infinity;
        for (const p of points) {
            const diff = Math.abs(p.time - targetTime);
            if (diff < minDiff) { minDiff = diff; closest = p; }
        }
        const hr = closest.hr ? Math.round(closest.hr) : null;
        const hrEl = document.getElementById("heart-rate-value");
        if (hrEl) { hrEl.textContent = hr ? `${hr} BPM` : "--"; }
    }

    // -------------------- ANIMATION LOOP --------------------
    function drawOverlay(currentTime) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!points || points.length < 2) return;

        const point = getInterpolatedPoint(currentTime);
        const lat = point.lat, lon = point.lon;
        if (marker) marker.setLatLng([lat, lon]);

        // Compute GPX time equivalent of current video time
        const targetTime = gpxStartMs + (currentTime / video.duration) * gpxDurationMs;

        // --- Binary search to find cutoff index (fast) ---
        let left = 0;
        let right = points.length - 1;
        while (left < right) {
            const mid = Math.floor((left + right) / 2);
            if (points[mid].time.getTime() < targetTime) {
                left = mid + 1;
            } else {
                right = mid;
            }
        }
        const cutoffIndex = Math.max(2, left);

        // --- Initialize routes and marker if not yet created ---
        if (!window._baseRoute) {
            const latlngs = points.map(p => [p.lat, p.lon]);
            window._baseRoute = L.polyline(latlngs, {
                color: "#666",
                weight: 4,
                opacity: 0.4,
                lineCap: "round"
            }).addTo(map);
            window._traveledRoute = L.polyline([], {
                color: "#007bff",
                weight: 6,
                opacity: 0.9,
                lineCap: "round"
            }).addTo(map);
            window._positionMarker = L.circleMarker([lat, lon], {
                radius: 6,
                color: "#ff3333",
                fillColor: "#ff3333",
                fillOpacity: 1,
                weight: 2,
                opacity: 1,
                className: "position-marker"
            }).addTo(map);
        }

        // --- Update traveled line and position marker ---
        const traveledLatLngs = points.slice(0, cutoffIndex).map(p => [p.lat, p.lon]);
        window._traveledRoute.setLatLngs(traveledLatLngs);

        if (window._positionMarker) {
            window._positionMarker.setLatLng([lat, lon]);
        }

        // --- Optional: visual glow on current position marker ---
        const el = document.querySelector(".position-marker");
        if (el) el.style.filter = "drop-shadow(0 0 6px rgba(255,0,0,0.8))";

        updateHeartRateOverlay(currentTime);
        drawSpeedometer(point.speed);
        drawElevationProfile(currentTime);
    }

    video.addEventListener("timeupdate", () => drawOverlay(video.currentTime));
    video.addEventListener("play", function loop() {
        if (!video.paused && !video.ended) {
            drawOverlay(video.currentTime);
            requestAnimationFrame(loop.bind(this));
        }
    });

    // -------------------- RECORDING + CONVERSION --------------------
    // Ensure a hidden recording canvas exists (create if missing)
    let recordCanvas = document.getElementById("recording-canvas");
    if (!recordCanvas) {
        recordCanvas = document.createElement("canvas");
        recordCanvas.id = "recording-canvas";
        recordCanvas.width = canvas.width || video.videoWidth || 1280;
        recordCanvas.height = canvas.height || video.videoHeight || 720;
        recordCanvas.style.display = "none";
        document.body.appendChild(recordCanvas);
    } else {
        // ensure size matches main canvas/video
        recordCanvas.width = canvas.width || video.videoWidth || recordCanvas.width;
        recordCanvas.height = canvas.height || video.videoHeight || recordCanvas.height;
    }
    const rctx = recordCanvas.getContext("2d");

    const recordBtn = document.getElementById("record-btn");

    // ffmpeg.wasm state
    let ffmpeg = null;
    let ffmpegLoaded = false;
    let ffmpegLoading = false;

    async function ensureFFmpeg() {
        if (ffmpegLoaded) return;
        if (ffmpegLoading) {
            // wait until loaded by another call
            while (!ffmpegLoaded) await new Promise(r => setTimeout(r, 200));
            return;
        }
        ffmpegLoading = true;
        console.log("⏳ Loading ffmpeg.wasm (this may take a few seconds)...");
        try {
            const mod = await import("https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.5/+esm");
            const { createFFmpeg, fetchFile } = mod;
            ffmpeg = createFFmpeg({ log: true, corePath: "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.5/dist/ffmpeg-core.js" });
            await ffmpeg.load();
            ffmpeg.fetchFile = fetchFile; // convenience
            ffmpegLoaded = true;
            console.log("✅ ffmpeg.wasm loaded");
        } catch (err) {
            console.error("❌ Failed to load ffmpeg.wasm:", err);
            ffmpegLoaded = false;
        } finally {
            ffmpegLoading = false;
        }
    }

    let recorder = null;
    let recordingStream = null;
    let isRecording = false;

    async function startRecording() {
        if (isRecording) return; // ✅ Prevent re-entry
        isRecording = true;

        const video = document.getElementById("video");
        video.pause(); // ⏸️ Pause before prompt

        try {
            console.log("🟢 Requesting display media...");
            recordingStream = await navigator.mediaDevices.getDisplayMedia({
                video: { frameRate: 30 },
                audio: false
            });

            const chunks = [];
            recorder = new MediaRecorder(recordingStream, {
                mimeType: "video/webm; codecs=vp9"
            });

            recorder.ondataavailable = e => chunks.push(e.data);
            recorder.onstop = async () => {
                const blob = new Blob(chunks, { type: "video/webm" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "overlay_recording.webm";
                a.click();
                URL.revokeObjectURL(url);
                console.log("✅ Recording saved.");

                // 🔴 Cleanup
                recordingStream.getTracks().forEach(t => t.stop());
                isRecording = false;
                recorder = null;
                recordingStream = null;
            };

            recorder.start();
            console.log("🎥 Recording started.");
            video.play(); // ▶️ Resume after permission granted

            const recordBtn = document.getElementById("record-btn");
            recordBtn.textContent = "Stop Recording";
            recordBtn.classList.add("recording");

            recordBtn.onclick = stopRecording;
        } catch (err) {
            console.error("❌ Screen capture failed:", err);
            isRecording = false;
            video.play(); // Resume anyway
        }
    }

    function stopRecording() {
        if (!recorder || !isRecording) return;
        console.log("🛑 Stopping recording...");
        recorder.stop();
    }

    // -------------------- wire up UI and auto-record behavior --------------------
    if (recordBtn) {
        recordBtn.addEventListener('click', () => {
            if (isRecording) stopRecording();
            else startRecording();
        });
    }

    // Auto-start recording when video plays, auto-stop when it ends
    video.addEventListener('play', () => {
        // if (!isRecording) startRecording();
    });
    video.addEventListener('ended', () => {
        if (isRecording) stopRecording();
    });

    // Ensure html2canvas exists (we use it for DOM heart overlay snapshot)
    if (!window.html2canvas) {
        console.warn("html2canvas not found — include html2canvas if you want the DOM heart overlay to be composited into the recording.");
    }

    // -------------------- Start by loading GPX --------------------
    loadGPX('./data/2025-10-12 Cycling.gpx');

    // expose some helpers for debugging if needed
    window._overlayRecording = {
        startRecording,
        stopRecording,
        ensureFFmpeg,
        isRecording: () => isRecording
    };

})(); // end async iife
