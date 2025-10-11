const video = document.getElementById("video");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");

let points = [];
let marker;
let traveledLine; // blue portion of the route
let gpxStartMs, gpxEndMs, gpxDurationMs;
let maxSpeed = 0; // mph
let minEle = 0, maxEle = 0;
let totalMiles = 0;

// Initialize map
const map = L.map("map").setView([0, 0], 13);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);

// -------------------- LOAD GPX --------------------
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

    // Clean and map points — include HR
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

    // Inherit missing HR values from previous points
    for (let i = 1; i < points.length; i++) {
        if (points[i].hr == null && points[i - 1].hr != null) {
            points[i].hr = points[i - 1].hr;
        }
    }

    // Compute distances, cumulative miles, and raw speed
    let cumulativeDist = 0;
    points[0].cumMiles = 0;
    points[0].speedMph = 0;

    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];

        const dMeters = haversineMeters(a, b);
        const dt = (b.time - a.time) / 1000; // seconds
        cumulativeDist += dMeters;
        b.cumMiles = cumulativeDist / 1609.34;

        // Calculate speed from distance/time (m/s → mph)
        b.speedMph = dt > 0 ? (dMeters / dt) * 2.23694 : a.speedMph;
    }

    // -------------------- Adaptive Speed Smoothing --------------------
    const smoothSpeed = (i, window) => {
        const start = Math.max(0, i - window);
        const end = Math.min(points.length - 1, i + window);
        let sum = 0, count = 0;
        for (let j = start; j <= end; j++) {
            if (!isNaN(points[j].speedMph)) {
                sum += points[j].speedMph;
                count++;
            }
        }
        return count > 0 ? sum / count : points[i].speedMph;
    };

    for (let i = 0; i < points.length; i++) {
        const s = points[i].speedMph;
        // Wider smoothing at low speeds, tighter at high
        // window = number of points to average on each side
        let window = 3; // default
        if (s < 5) window = 6;      // slow or stopped → heavily smoothed
        else if (s < 10) window = 4;
        else if (s < 20) window = 3;
        else if (s < 30) window = 2;
        else window = 1;            // high speed → responsive
        points[i].speedMph = smoothSpeed(i, window);
    }

    // Compute elevation range
    minEle = Math.min(...points.map(p => p.ele));
    maxEle = Math.max(...points.map(p => p.ele));

    // Determine max speed for gauge scaling
    maxSpeed = Math.ceil(Math.max(...points.map(p => p.speedMph)) / 10) * 10 || 10;

    // GPX time range
    gpxStartMs = points[0].time.getTime();
    gpxEndMs = points[points.length - 1].time.getTime();
    gpxDurationMs = gpxEndMs - gpxStartMs;

    // Draw route on map
    const latlngs = points.map(p => [p.lat, p.lon]);
    L.polyline(latlngs, { color: "gray", weight: 3 }).addTo(map);
    baseRoute = L.polyline(points.map(p => [p.lat, p.lon]), { color: "#777", weight: 4, opacity: 0.4 }).addTo(map);
    // Blue route for traveled portion (starts empty)
    traveledLine = L.polyline([], { color: "blue", weight: 3 }).addTo(map);
    map.fitBounds(latlngs);
    marker = L.circleMarker(latlngs[0], { radius: 5, color: "red" }).addTo(map);

    totalMiles = points[points.length - 1].cumMiles;

    console.log(
        `Loaded ${points.length} points. Distance: ${totalMiles.toFixed(2)} mi, Max speed: ${maxSpeed} mph`
    );
}

// -------------------- HELPERS --------------------
function haversineMeters(a, b) {
    const R = 6371000;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLon = (b.lon - a.lon) * Math.PI / 180;
    const lat1 = a.lat * Math.PI / 180;
    const lat2 = b.lat * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function getInterpolatedPoint(currentTime) {
    const targetTime = gpxStartMs + (currentTime / video.duration) * gpxDurationMs;
    for (let i = 1; i < points.length; i++) {
        const t1 = points[i - 1].time.getTime();
        const t2 = points[i].time.getTime();
        if (targetTime >= t1 && targetTime <= t2) {
            const ratio = (targetTime - t1) / (t2 - t1);
            const lat = points[i - 1].lat + (points[i].lat - points[i - 1].lat) * ratio;
            const lon = points[i - 1].lon + (points[i].lon - points[i - 1].lon) * ratio;
            const speed = points[i - 1].speedMph + (points[i].speedMph - points[i - 1].speedMph) * ratio;
            const ele = points[i - 1].ele + (points[i].ele - points[i - 1].ele) * ratio;
            const miles = points[i - 1].cumMiles + (points[i].cumMiles - points[i - 1].cumMiles) * ratio;
            return { lat, lon, speed: isFinite(speed) ? speed : 0, ele, miles };
        }
    }
    const last = points[points.length - 1];
    return { lat: last.lat, lon: last.lon, speed: 0, ele: last.ele, miles: totalMiles };
}

// -------------------- DRAW SPEEDOMETER (TOP-RIGHT) --------------------
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

// -------------------- DRAW ELEVATION PROFILE (GRADIENT COLOR) --------------------
function drawElevationProfile(currentTime) {
    const margin = 60;
    const chartHeight = 150;
    const graphBottom = canvas.height - 30; // near bottom
    const graphTop = graphBottom - chartHeight;
    const graphLeft = margin;
    const graphRight = canvas.width - margin;

    // --- Prepare safe values ---
    const totalMilesSafe = totalMiles && totalMiles > 0 ? totalMiles : 1;
    const minEleFt = minEle * 3.28084;
    const maxEleFt = maxEle * 3.28084;
    const eleRangeFt = (maxEleFt - minEleFt) || 1; // avoid div0

    // --- Single solid fill color under the elevation curve (transparent background removed) ---
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

    ctx.fillStyle = "rgba(0,188,212,0.35)"; // single fill color
    ctx.fill();

    // --- Draw slope-colored line segments on top ---
    for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const curr = points[i];

        // segment horizontal distance (meters) and vertical change (meters)
        const distMeters = (curr.cumMiles - prev.cumMiles) * 1609.34;
        const elevChangeMeters = curr.ele - prev.ele;

        // slope % = (rise / run) * 100, computed in meters
        const slopePct = distMeters > 0 ? (elevChangeMeters / distMeters) * 100 : 0;

        // Determine stroke color by slope %
        let color;
        if (slopePct < -3) color = "#00ff88";     // downhill
        else if (slopePct < 1) color = "#ffff66"; // flat
        else if (slopePct < 5) color = "#ff9933"; // mild climb
        else color = "#ff3333";                   // steep climb

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

    // --- Axes ---
    ctx.strokeStyle = "#999";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(graphLeft, graphBottom);
    ctx.lineTo(graphRight, graphBottom); // X axis
    ctx.moveTo(graphLeft, graphBottom);
    ctx.lineTo(graphLeft, graphTop);     // Y axis
    ctx.stroke();

    // --- X-axis ticks (distance) ---
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

    // --- Y-axis ticks (elevation in ft) ---
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

    // --- Progress marker ---
    const p = getInterpolatedPoint(currentTime);
    const markerX = graphLeft + (p.miles / totalMilesSafe) * (graphRight - graphLeft);
    const markerY = graphBottom - (((p.ele * 3.28084) - minEleFt) / eleRangeFt) * chartHeight;
    ctx.beginPath();
    ctx.arc(markerX, markerY, 5, 0, 2 * Math.PI);
    ctx.fillStyle = "red";
    ctx.fill();

    // --- Tooltip (Elevation + Slope %) ---
    // compute slope % at current segment using meters
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
        if (diff < minDiff) {
            closest = p;
            minDiff = diff;
        }
    }

    const hr = closest.hr ? Math.round(closest.hr) : null;
    const hrEl = document.getElementById("heart-rate-value");
    if (hrEl) {
        hrEl.textContent = hr ? `${hr} BPM` : "--";
    }
}

// -------------------- ANIMATION LOOP --------------------
function drawOverlay(currentTime) {
    // --- Clear overlay canvas each frame ---
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!points || points.length < 2) return;

    // --- Get interpolated position for this timestamp ---
    const point = getInterpolatedPoint(currentTime);
    const lat = point.lat;
    const lon = point.lon;
    if (marker) marker.setLatLng([lat, lon]);

    // --- Calculate progress ---
    const progress = currentTime / video.duration;
    const cutoffIndex = Math.max(2, Math.floor(points.length * progress));

    // --- Initialize base route, traveled route, and position marker once ---
    if (!window._baseRoute) {
        const latlngs = points.map(p => [p.lat, p.lon]);

        // Full gray base route (untraveled)
        window._baseRoute = L.polyline(latlngs, {
            color: "#666",
            weight: 4,
            opacity: 0.4,
            lineCap: "round",
        }).addTo(map);

        // Blue traveled route
        window._traveledRoute = L.polyline([], {
            color: "#007bff",
            weight: 6,
            opacity: 0.9,
            lineCap: "round",
        }).addTo(map);

        // Red position marker (small circle)
        window._positionMarker = L.circleMarker([lat, lon], {
            radius: 6,
            color: "#ff3333",
            fillColor: "#ff3333",
            fillOpacity: 1,
            weight: 2,
            opacity: 1,
            className: "position-marker",
        }).addTo(map);
    }

    // --- Update traveled route dynamically ---
    const traveledLatLngs = points.slice(0, cutoffIndex).map(p => [p.lat, p.lon]);
    window._traveledRoute.setLatLngs(traveledLatLngs);

    // --- Update red position marker ---
    if (window._positionMarker) window._positionMarker.setLatLng([lat, lon]);

    // --- Optional subtle glow for visibility ---
    const el = document.querySelector(".position-marker");
    if (el) el.style.filter = "drop-shadow(0 0 6px rgba(255,0,0,0.8))";

    // --- Draw overlays ---
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

loadGPX("track_ext.gpx");
