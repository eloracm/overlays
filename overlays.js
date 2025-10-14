// overlays.js — Clean rewrite with GPX/video sync fixes, dual maps, and continuous RAF
// Debug logging intentionally left in.

import { loadVideoMeta } from './VideoTimestamps.js';

(async () => {
    // -------------------- DOM & Canvas Setup --------------------
    const videoEl = document.getElementById('video');
    videoEl.addEventListener("loadedmetadata", () => {
        initVideoTiming(videoEl.currentSrc || videoEl.src);
    });
    const canvas = document.getElementById('overlay');
    const ctx = canvas.getContext('2d');

    const overlayClockEl = ensureClockElement();

    // Display vs internal resolution (you use a 4K internal canvas mapped to display size)
    const DISPLAY_W = 1280;
    const DISPLAY_H = 720;
    const INTERNAL_W = 3840;
    const INTERNAL_H = 2160;

    canvas.width = INTERNAL_W;
    canvas.height = INTERNAL_H;
    canvas.style.width = `${DISPLAY_W}px`;
    canvas.style.height = `${DISPLAY_H}px`;

    // Map drawing scale: we will draw using DISPLAY coords but canvas is scaled internally
    const scaleX = INTERNAL_W / DISPLAY_W;
    const scaleY = INTERNAL_H / DISPLAY_H;
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);

    // small overlay canvases
    const speedCanvas = document.getElementById('speedometer-canvas');
    const sctx = speedCanvas.getContext('2d');
    const eleCanvas = document.getElementById('elevation-canvas');
    const ectx = eleCanvas.getContext('2d');

    // -------------------- State --------------------
    let points = []; // normalized telemetry points from GPX
    let minEle = 0, maxEle = 0, totalMiles = 0;
    let maxSpeed = 30;

    // Maps and markers
    let map = null;           // static full route map
    let dynMap = null;        // dynamic mini map
    let routeLine = null;
    let staticMarker = null;
    let traveledLine = null;
    let dynRoute = null;
    let arrowMarker = null;

    // Sync state
    let gpxStartMs = null;
    let gpxEndMs = null;
    let gpxDurationMs = null;
    let videoDurationSec = null;
    let gpxToVideoOffsetMs = 0; // offset to align gpx time to video time (can be tweaked)
    let startedRAF = false;

    // smoothing
    let lastHeading = 0;

    // start RAF immediately
    if (!startedRAF) {
        startedRAF = true;
        requestAnimationFrame(rafLoop);
    }

    // Trigger an immediate draw when play starts so overlays reflect current time instantly
    videoEl.addEventListener('play', () => {
        if (points && points.length > 1) {
            updateMapsAndOverlaysForVideoTime(videoEl.currentTime || 0);
        }
    });

    // Also update when video seeks (fast jump)
    videoEl.addEventListener('seeked', () => {
        if (points && points.length > 1) {
            updateMapsAndOverlaysForVideoTime(videoEl.currentTime || 0);
        }
    });

    // -------------------- RECORDING (preserve your existing behavior) --------------------
    // Recreate recording canvas if missing and keep your current recording logic intact
    let recordCanvas = document.getElementById('recording-canvas');
    if (!recordCanvas) {
        recordCanvas = document.createElement('canvas');
        recordCanvas.id = 'recording-canvas';
        document.body.appendChild(recordCanvas);
    }
    recordCanvas.width = INTERNAL_W;
    recordCanvas.height = INTERNAL_H;
    recordCanvas.style.display = 'none';
    const rctx = recordCanvas.getContext('2d');
    rctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

    const recordBtn = document.getElementById('record-btn');
    let recorder = null, recordingStream = null, isRecording = false;

    videoEl.addEventListener('ended', () => { if (isRecording) stopRecording(); });

    // -------------------- STARTUP --------------------
    // load GPX (adjust this path to your file)
    await loadGPX('./data/GX010766_1_GPS5.gpx');
    // Draw initial overlays at start position
    requestAnimationFrame(() => {
        if (points && points.length > 1) {
            const startMs = gpxStartMs;
            const cur = interpolatePoint(startMs);
            if (cur) {
                applyInterpolated(cur, startMs);
            }
        }
    });

    const applied = autoCorrectVideoMetaAgainstGPX(window.videoTiming);
    if (applied !== 0) {
        console.log(`[Overlay] Applied video->GPX time correction: ${applied} ms (${(applied / 3600000).toFixed(3)} hours)`);
    } else {
        console.log("[Overlay] No time correction needed.");
    }

    // if video metadata available now, set videoDurationSec to help mapping
    videoEl.addEventListener('loadedmetadata', () => {
        videoDurationSec = videoEl.duration;
        console.log('Video duration (sec):', videoDurationSec);
    });

    // Expose some helpers for debugging from console
    window._overlayDebug = {
        points, gpxStartMs, gpxEndMs, gpxDurationMs,
        setOffsetMs: (ms) => { gpxToVideoOffsetMs = ms; console.log('gpxToVideoOffsetMs set to', ms); },
        forceUpdate: () => updateMapsAndOverlaysForVideoTime(videoEl.currentTime || 0)
    };

    console.log('Overlays initialized. Waiting for play or seek events to start showing live overlay.');

    // -------------------- HELPERS --------------------
    async function initVideoTiming(videoUrl) {
        console.log("[Overlay] Initializing video timing...");
        try {
            const meta = await loadVideoMeta(videoUrl);
            window.videoTiming = meta;
            console.log(`[Overlay] Video timing ready for ${meta.file}`);
        } catch (err) {
            console.error("[Overlay] Video timing initialization failed:", err);
        }
    }

    function haversineMeters(a, b) {
        const R = 6371000;
        const toRad = Math.PI / 180;
        const dLat = (b.lat - a.lat) * toRad;
        const dLon = (b.lon - a.lon) * toRad;
        const lat1 = a.lat * toRad;
        const lat2 = b.lat * toRad;
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }

    function bearingBetweenDeg(a, b) {
        const toRad = Math.PI / 180, toDeg = 180 / Math.PI;
        const lat1 = a.lat * toRad, lat2 = b.lat * toRad;
        const dLon = (b.lon - a.lon) * toRad;
        const y = Math.sin(dLon) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
        let brng = Math.atan2(y, x) * toDeg;
        brng = (brng + 360) % 360;
        return brng;
    }

    // Binary search to find index where points[idx].time >= tMs
    function findIndexByTime(tMs) {
        if (!points || points.length === 0) return 0;
        let left = 0, right = points.length - 1;
        while (left < right) {
            const mid = (left + right) >> 1;
            if (points[mid].timeMs < tMs) left = mid + 1;
            else right = mid;
        }
        return left;
    }

    // Interpolate to get a smooth sample for arbitrary targetTimeMs (absolute GPX time)
    function interpolatePoint(targetTimeMs) {
        if (!points || points.length === 0) return null;
        if (targetTimeMs <= points[0].timeMs) {
            return { ...points[0], idxLeft: 0, idxRight: 0, ratio: 0 };
        }
        if (targetTimeMs >= points[points.length - 1].timeMs) {
            const last = points[points.length - 1];
            return { ...last, idxLeft: points.length - 1, idxRight: points.length - 1, ratio: 0 };
        }

        let right = findIndexByTime(targetTimeMs);
        let left = Math.max(0, right - 1);
        const a = points[left], b = points[right];
        if (!a || !b) return null;

        const t1 = a.timeMs, t2 = b.timeMs;
        const ratio = t2 === t1 ? 0 : (targetTimeMs - t1) / (t2 - t1);
        const lerp = (v1, v2) => v1 + (v2 - v1) * ratio;

        return {
            lat: lerp(a.lat, b.lat),
            lon: lerp(a.lon, b.lon),
            ele: lerp(a.ele, b.ele),
            speed: lerp(a.speedMph || 0, b.speedMph || 0),
            miles: lerp(a.cumMiles || 0, b.cumMiles || 0),
            idxLeft: left,
            idxRight: right,
            ratio
        };
    }

    // -------------------- GPX LOADER & NORMALIZER --------------------
    async function loadGPX(url) {
        console.log('Loading GPX:', url);
        const res = await fetch(url);
        const xmlText = await res.text();
        const parser = new DOMParser();
        const xml = parser.parseFromString(xmlText, 'application/xml');

        const trkpts = xml.getElementsByTagName('trkpt');
        if (!trkpts || trkpts.length === 0) {
            console.error('GPX: no track points found.');
            return;
        }

        // parse trkpts into normalized points array
        const raw = Array.from(trkpts).map(node => {
            const lat = parseFloat(node.getAttribute('lat'));
            const lon = parseFloat(node.getAttribute('lon'));
            const eleNode = node.getElementsByTagName('ele')[0];
            const timeNode = node.getElementsByTagName('time')[0];
            const ele = eleNode ? parseFloat(eleNode.textContent) : 0;
            const timeStr = timeNode ? timeNode.textContent : null;
            const timeMs = timeStr ? (new Date(timeStr)).getTime() : NaN;
            // optional HR in GPX extensions; attempt to parse common tags
            let hr = null;
            const hrNode = node.querySelector('gpxtpx\\:hr, hr, gpxtpx\\:hr');
            if (hrNode) hr = parseFloat(hrNode.textContent);
            return { lat, lon, ele, timeMs, hr };
        }).filter(p => !isNaN(p.timeMs) && !isNaN(p.lat) && !isNaN(p.lon));

        if (raw.length < 2) {
            console.error('GPX: not enough valid points with timestamps.');
            return;
        }

        // compute cumulative distances, speeds, etc.
        let cumulMeters = 0;
        raw[0].cumMiles = 0;
        raw[0].speedMph = raw[0].speedMph || 0;
        for (let i = 1; i < raw.length; i++) {
            const a = raw[i - 1], b = raw[i];
            const d = haversineMeters(a, b);
            const dt = (b.timeMs - a.timeMs) / 1000;
            cumulMeters += d;
            b.cumMiles = cumulMeters / 1609.34;
            b.speedMph = dt > 0 ? (d / dt) * 2.23694 : (a.speedMph || 0);
            if (!b.hr && a.hr) b.hr = a.hr;
        }

        // smooth speeds (small adaptive window)
        const smoothSpeed = (i) => {
            const s = raw[i].speedMph || 0;
            let window = 3;
            if (s < 5) window = 6;
            else if (s < 10) window = 4;
            else if (s < 20) window = 3;
            else if (s < 30) window = 2;
            let sum = 0, count = 0;
            for (let j = Math.max(0, i - window); j <= Math.min(raw.length - 1, i + window); j++) {
                sum += (raw[j].speedMph || 0);
                count++;
            }
            return count ? sum / count : s;
        };
        for (let i = 0; i < raw.length; i++) raw[i].speedMph = smoothSpeed(i);

        // assign to global state
        points = raw.map(p => ({
            lat: p.lat, lon: p.lon, ele: p.ele, timeMs: p.timeMs, hr: p.hr || null,
            cumMiles: p.cumMiles || 0, speedMph: p.speedMph || 0
        }));

        minEle = Math.min(...points.map(p => p.ele));
        maxEle = Math.max(...points.map(p => p.ele));
        totalMiles = points[points.length - 1].cumMiles || 0.01;
        maxSpeed = Math.ceil(Math.max(...points.map(p => p.speedMph || 0)) / 10) * 10 || 30;

        gpxStartMs = points[0].timeMs;
        gpxEndMs = points[points.length - 1].timeMs;
        gpxDurationMs = gpxEndMs - gpxStartMs;

        console.log('GPX loaded', points.length, 'points', 'start:', new Date(gpxStartMs).toISOString(), 'end:', new Date(gpxEndMs).toISOString());

        // Attempt to set videoDuration if available
        if (videoEl && videoEl.duration && !isNaN(videoEl.duration) && isFinite(videoEl.duration)) {
            videoDurationSec = videoEl.duration;
        }

        // initialize maps now that points exist
        initMaps(points);
    }

    // -------------------- MAPS (static + dynamic) --------------------
    function initMaps(trackPoints) {
        const latlngs = trackPoints.map(p => [p.lat, p.lon]);
        const bounds = L.latLngBounds(latlngs);

        // --- dynamic resize static map container based on route aspect ---
        const mapDiv = document.getElementById('map');
        const latSpan = bounds.getNorth() - bounds.getSouth();
        const lonSpan = bounds.getEast() - bounds.getWest();
        const aspect = lonSpan === 0 ? 1 : latSpan / lonSpan;

        const maxH = 250, maxW = 330;
        let width = maxW, height = maxH;
        if (aspect > 1) { // taller
            height = maxH;
            width = Math.max(180, Math.round(maxH / aspect));
        } else {
            width = maxW;
            height = Math.max(140, Math.round(maxW * aspect));
        }
        mapDiv.style.width = `${width}px`;
        mapDiv.style.height = `${height}px`;
        console.log('Static map resized to', width, 'x', height);

        // --- static map setup (north-up) ---
        if (!map) {
            map = L.map('map', { zoomSnap: 0.25, zoomDelta: 0.25, zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false });
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { detectRetina: true }).addTo(map);
        }

        if (routeLine) map.removeLayer(routeLine);
        routeLine = L.polyline(latlngs, { color: '#666', weight: 4, opacity: 0.8 }).addTo(map);

        if (staticMarker) map.removeLayer(staticMarker);
        staticMarker = L.circleMarker(latlngs[0], { radius: 6, color: '#ffcc33', fillColor: '#ffcc33', fillOpacity: 1 }).addTo(map);

        // gentle padded bounds so path doesn't hug edges
        const padLat = (bounds.getNorth() - bounds.getSouth()) * 0.05;
        const padLon = (bounds.getEast() - bounds.getWest()) * 0.05;
        const padded = L.latLngBounds([bounds.getSouth() - padLat, bounds.getWest() - padLon], [bounds.getNorth() + padLat, bounds.getEast() + padLon]);

        try {
            map.fitBounds(padded, { padding: [20, 20], maxZoom: 13 });
        } catch (e) {
            map.setView(latlngs[0], 13);
        }
        setTimeout(() => { try { map.invalidateSize(); } catch (e) { } }, 200);

        // --- dynamic mini map ---
        const dynDiv = document.getElementById('dynamic-map');
        if (!dynMap) {
            dynMap = L.map('dynamic-map', { zoomSnap: 0.25, zoomDelta: 0.25, zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false });
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { detectRetina: true }).addTo(dynMap);
        }

        if (dynRoute) dynMap.removeLayer(dynRoute);
        dynRoute = L.polyline(latlngs, { color: '#00bcd4', weight: 3, opacity: 0.9 }).addTo(dynMap);

        // Arrow SVG (gold); we rotate the inner svg element via style transform for smooth rotation
        const arrowHTML = `
      <svg width="40" height="40" viewBox="0 0 40 40">
        <polygon points="20,5 35,35 20,28 5,35" fill="#ffcc33" stroke="#e0a800" stroke-width="2"/>
      </svg>
    `;
        const arrowIcon = L.divIcon({ className: 'arrow-icon', html: arrowHTML, iconSize: [40, 40], iconAnchor: [20, 20] });

        if (arrowMarker) dynMap.removeLayer(arrowMarker);
        arrowMarker = L.marker(latlngs[0], { icon: arrowIcon }).addTo(dynMap);

        // traveled line on static map
        if (traveledLine) map.removeLayer(traveledLine);
        traveledLine = L.polyline([], { color: '#007bff', weight: 5, opacity: 0.9 }).addTo(map);

        // dynMap initial view: slightly ahead of start so arrow isn't on edge
        const quarterIdx = Math.min(latlngs.length - 1, Math.floor(latlngs.length * 0.05));
        dynMap.setView(latlngs[quarterIdx], 17);
        setTimeout(() => { try { dynMap.invalidateSize(); } catch (e) { } }, 200);

        console.log('Maps initialized.');
    }

    // -------------------- DRAW UTILITIES --------------------

    // create top-center clock element (local time)
    function ensureClockElement() {
        let clk = document.getElementById('clock-overlay');
        clk.textContent = '--:--:--';
        return clk;
    }

    function drawSpeedometer(speed) {
        const ctx = sctx;
        const w = speedCanvas.width, h = speedCanvas.height;
        ctx.clearRect(0, 0, w, h);

        const cx = w / 2, cy = h / 2;
        const r = 80;
        const minAngle = Math.PI, maxAngle = 2 * Math.PI;
        const range = maxAngle - minAngle;

        // background arc
        ctx.beginPath();
        ctx.arc(cx, cy, r, minAngle, maxAngle);
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 8;
        ctx.stroke();

        // ticks
        ctx.lineWidth = 2;
        ctx.font = '10px sans-serif';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        for (let mph = 0; mph <= maxSpeed; mph += 10) {
            const ratio = mph / maxSpeed;
            const a = minAngle + ratio * range;
            const x1 = cx + Math.cos(a) * (r - 4), y1 = cy + Math.sin(a) * (r - 4);
            const x2 = cx + Math.cos(a) * (r - 12), y2 = cy + Math.sin(a) * (r - 12);
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.stroke();
            const lx = cx + Math.cos(a) * (r - 26), ly = cy + Math.sin(a) * (r - 26);
            ctx.fillText(mph.toString(), lx, ly);
        }

        const cur = Math.min(speed || 0, maxSpeed);
        const needle = minAngle + (cur / maxSpeed) * range;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(needle) * (r - 18), cy + Math.sin(needle) * (r - 18));
        ctx.strokeStyle = 'red'; ctx.lineWidth = 3; ctx.stroke();

        ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fillStyle = 'red'; ctx.fill();

        ctx.font = 'bold 20px sans-serif'; ctx.fillStyle = 'white'; ctx.fillText(`${cur.toFixed(1)} mph`, cx, cy + 50);
    }

    function drawElevation(currentTargetTimeMs) {
        if (!points || points.length < 2) return;
        const ctx = ectx;
        const w = eleCanvas.width, h = eleCanvas.height;
        ctx.clearRect(0, 0, w, h);

        const margin = { left: 60, right: 40, top: 20, bottom: 36 };
        const gxL = margin.left, gxR = w - margin.right, gxT = margin.top, gxB = h - margin.bottom;
        const graphH = gxB - gxT;

        const minEleFt = minEle * 3.28084, maxEleFt = maxEle * 3.28084, eleRange = Math.max(1, maxEleFt - minEleFt);
        const totalMilesSafe = Math.max(totalMiles, 0.01);

        // filled area
        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
            const x = gxL + (points[i].cumMiles / totalMilesSafe) * (gxR - gxL);
            const y = gxB - ((points[i].ele * 3.28084 - minEleFt) / eleRange) * graphH;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.lineTo(gxR, gxB); ctx.lineTo(gxL, gxB); ctx.closePath();
        ctx.fillStyle = 'rgba(0,188,212,0.22)'; ctx.fill();

        // colored segments
        for (let i = 1; i < points.length; i++) {
            const p0 = points[i - 1], p1 = points[i];
            const distM = (p1.cumMiles - p0.cumMiles) * 1609.34;
            const elevDelta = p1.ele - p0.ele;
            const slope = distM > 0 ? (elevDelta / distM) * 100 : 0;
            let color = '#ffff66';
            if (slope < -3) color = '#00ff88';
            else if (slope < 1) color = '#ffff66';
            else if (slope < 5) color = '#ff9933';
            else color = '#ff3333';
            const x1 = gxL + (p0.cumMiles / totalMilesSafe) * (gxR - gxL);
            const y1 = gxB - ((p0.ele * 3.28084 - minEleFt) / eleRange) * graphH;
            const x2 = gxL + (p1.cumMiles / totalMilesSafe) * (gxR - gxL);
            const y2 = gxB - ((p1.ele * 3.28084 - minEleFt) / eleRange) * graphH;
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
        }

        // axes & ticks
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(gxL, gxB); ctx.lineTo(gxR, gxB); ctx.lineTo(gxR, gxT); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';

        const xTicks = 5;
        for (let i = 0; i <= xTicks; i++) {
            const ratio = i / xTicks;
            const x = gxL + ratio * (gxR - gxL);
            const miles = (totalMilesSafe * ratio);
            ctx.beginPath(); ctx.moveTo(x, gxB); ctx.lineTo(x, gxB + 4); ctx.stroke();
            ctx.fillText(miles.toFixed(1), x, gxB + 16);
        }

        // Y ticks
        ctx.textAlign = 'right';
        const yTicks = 5;
        for (let i = 0; i <= yTicks; i++) {
            const ratio = i / yTicks;
            const y = gxB - ratio * graphH;
            const eleFt = Math.round(minEleFt + ratio * eleRange);
            ctx.beginPath(); ctx.moveTo(gxL - 4, y); ctx.lineTo(gxL, y); ctx.stroke();
            ctx.fillText(eleFt, gxL - 8, y + 4);
        }

        // current marker
        const cur = interpolatePoint(currentTargetTimeMs);
        if (cur) {
            const markerX = gxL + (cur.miles / totalMilesSafe) * (gxR - gxL);
            const markerY = gxB - ((cur.ele * 3.28084 - minEleFt) / eleRange) * graphH;
            ctx.beginPath(); ctx.arc(markerX, markerY, 5, 0, Math.PI * 2); ctx.fillStyle = 'red'; ctx.fill();
            ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = 'white';
            ctx.fillText(`${Math.round(cur.ele * 3.28084)} ft`, markerX, markerY - 10);
            // debug
            // console.log('elevationProfile: (markerX, markerY) =', markerX, markerY);
        }
    }

    function updateHeartRate(currentTargetTimeMs) {
        if (!points || points.length === 0) return;
        // find nearest point
        const idx = findIndexByTime(currentTargetTimeMs);
        const chosen = points[Math.max(0, idx - 1)];
        const hrVal = chosen && chosen.hr ? Math.round(chosen.hr) : null;
        const el = document.getElementById('heart-rate-value');
        if (el) el.textContent = hrVal ? `${hrVal} BPM` : '--';
    }

    // If a large mismatch between video timestamps and GPX times exists,
    // automatically compute and apply an offset to the loaded video meta.
    // Returns applied offset in ms (can be 0).
    function autoCorrectVideoMetaAgainstGPX(meta) {
        if (!meta || !meta.frameTimesMs || !meta.frameTimesMs.length) return 0;
        if (!gpxStartMs || !gpxEndMs) return 0;

        // Use the first non-NaN frame time as representative
        const firstFrameMs = meta.frameTimesMs.find(t => Number.isFinite(t));
        if (!firstFrameMs) return 0;

        // Compute difference: positive => GPX is later than video by delta ms
        const deltaMs = gpxStartMs - firstFrameMs;

        console.log(`[AutoCorrect] deltaMs between GPX start and first video frame: ${deltaMs} ms`);

        // If absolute delta is small, consider already aligned
        const THRESHOLD_MS = 3 * 3600 * 1000; // 3 hours default threshold
        if (Math.abs(deltaMs) < THRESHOLD_MS) {
            console.log("[AutoCorrect] Delta within threshold; no correction applied.");
            return 0;
        }

        // If delta is large, apply correction by shifting video metadata timestamps by delta.
        // This assumes the entire video timeline should be shifted by delta to align with GPX.
        console.warn(`[AutoCorrect] Large delta detected (${(deltaMs / 3600000).toFixed(2)} h). Applying correction of ${deltaMs} ms to video metadata.`);

        // Apply correction in-place
        meta.creationMs = (meta.creationMs || 0) + deltaMs;
        if (Array.isArray(meta.frameTimesMs)) {
            meta.frameTimesMs = meta.frameTimesMs.map(t => (Number.isFinite(t) ? t + deltaMs : t));
        }

        // Return applied value for logging or further adjustments
        return deltaMs;
    }

    // --- Helper: format elapsed seconds as HH:MM:SS.mmm ---
    function formatElapsedSeconds(sec) {
        if (!isFinite(sec)) sec = 0;
        const hours = Math.floor(sec / 3600);
        const minutes = Math.floor((sec % 3600) / 60);
        const seconds = Math.floor(sec % 60);
        if (hours > 0) {
            return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    // --- Updated clock: show mapped video timestamp (local) or elapsed fallback ---
    function updateClock() {
        try {
            // Prefer the mapped absolute timestamp (based on creation_time + PTS)
            let vtsDate = null;
            try {
                vtsDate = getCurrentVideoTimestamp(); // expected to return a Date or null
            } catch (e) {
                // keep vtsDate null and fallback below
                console.warn('[Overlay] getCurrentVideoTimestamp() threw:', e);
                vtsDate = null;
            }

            if (vtsDate instanceof Date && !isNaN(vtsDate.getTime())) {
                // Show local time derived from the video's mapped timestamp
                // Example format: "14:40:45.123" (local)
                const hh = String(vtsDate.getHours()).padStart(2, '0');
                const mm = String(vtsDate.getMinutes()).padStart(2, '0');
                const ss = String(vtsDate.getSeconds()).padStart(2, '0');
                const ms = String(vtsDate.getMilliseconds()).padStart(3, '0');
                overlayClockEl.textContent = `${hh}:${mm}:${ss}.${ms}`;
            } else {
                // Fallback: show video elapsed time (currentTime) as HH:MM:SS.mmm
                const elapsed = (videoEl && typeof videoEl.currentTime === 'number') ? videoEl.currentTime : 0;
                overlayClockEl.textContent = formatElapsedSeconds(elapsed);
            }
        } catch (err) {
            // swallow errors to avoid spamming console during RAF
            // keep the element stable (do nothing)
        }
    }

    // -------------------- UNIFIED DRAW/UPDATE --------------------
    function updateMapsAndOverlaysForVideoTime() {
        if (!points || points.length < 2) return;

        const videoTimestamp = getCurrentVideoTimestamp();
        if (!videoTimestamp) return;

        const targetTimeMs = videoTimestamp.getTime();
        const clampedTimeMs = Math.min(Math.max(targetTimeMs, gpxStartMs), gpxEndMs);
        const cur = interpolatePoint(clampedTimeMs);
        if (!cur) return;

        applyInterpolated(cur, clampedTimeMs);
    }


    function applyInterpolated(cur, targetTimeMs) {
        // --- Static map marker ---
        if (staticMarker && cur.lat && cur.lon)
            staticMarker.setLatLng([cur.lat, cur.lon]);

        // --- Dynamic map + heading arrow ---
        if (arrowMarker && dynMap) {
            arrowMarker.setLatLng([cur.lat, cur.lon]);
            dynMap.panTo([cur.lat, cur.lon], { animate: false });

            // Compute heading between neighbor points
            const leftIdx = Math.max(0, cur.idxLeft || 0);
            const rightIdx = Math.min(points.length - 1, cur.idxRight || leftIdx);
            const prev = points[leftIdx], next = points[rightIdx];
            let heading = 0;
            if (prev && next) heading = bearingBetweenDeg(prev, next);

            // Smooth heading transitions
            const alpha = 0.15;
            let d = ((heading - lastHeading + 540) % 360) - 180;
            lastHeading = (lastHeading + alpha * d + 360) % 360;

            const el = arrowMarker.getElement();
            if (el) {
                const svg = el.querySelector('svg');
                if (svg) {
                    svg.style.transform = `rotate(${lastHeading}deg)`;
                    svg.style.transformOrigin = '20px 20px';
                }
            }
        }

        // --- Traveled polyline on static map ---
        if (map && routeLine && traveledLine) {
            const cutoffIndex = Math.min(points.length - 1, (cur.idxRight || 0));
            const traveledLatLngs = points.slice(0, cutoffIndex + 1).map(p => [p.lat, p.lon]);
            traveledLine.setLatLngs(traveledLatLngs);
        }

        // --- Overlays ---
        const interpTimeMs =
            (cur && cur.idxLeft !== undefined)
                ? points[cur.idxLeft].timeMs +
                (points[cur.idxRight].timeMs - points[cur.idxLeft].timeMs) * cur.ratio
                : gpxStartMs;

        drawSpeedometer(cur.speed || 0);
        drawElevation(interpTimeMs);
        updateHeartRate(interpTimeMs);
    }

    function getCurrentVideoTimestamp() {
        const meta = window.videoTiming;
        if (!meta) return null;

        // Normalize creationMs if missing
        if (!meta.creationMs && meta.creation_time) {
            meta.creationMs = new Date(meta.creation_time).getTime();
        }
        if (!meta.creationMs || isNaN(meta.creationMs)) {
            console.warn("[Overlay] Missing creationMs; using fallback epoch");
            meta.creationMs = Date.now() - videoEl.currentTime * 1000;
        }

        const t = videoEl.currentTime;
        return new Date(meta.creationMs + t * 1000);
    }

    // -------------------- ANIMATION LOOP --------------------
    function rafLoop() {
        // update running clock each frame (fast; cheap)
        updateClock();

        // Only update when video and GPX are ready
        if (videoEl && points && points.length > 1 && gpxStartMs) {
            try {
                updateMapsAndOverlaysForVideoTime(); // no argument needed
            } catch (err) {
                console.error('Error during overlay update:', err);
            }
        }
        requestAnimationFrame(rafLoop);
    }

    async function startRecording() {
        if (isRecording) return;
        isRecording = true;
        videoEl.pause();
        try {
            recordingStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
            const chunks = [];
            recorder = new MediaRecorder(recordingStream, { mimeType: 'video/webm; codecs=vp9' });
            recorder.ondataavailable = e => chunks.push(e.data);
            recorder.onstop = async () => {
                const blob = new Blob(chunks, { type: 'video/webm' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = 'overlay_recording.webm'; a.click();
                URL.revokeObjectURL(url);
                recordingStream.getTracks().forEach(t => t.stop());
                isRecording = false;
                recorder = null;
                recordingStream = null;
            };
            recorder.start();
            videoEl.play();
            if (recordBtn) { recordBtn.textContent = 'Stop Recording'; recordBtn.classList.add('recording'); recordBtn.onclick = stopRecording; }
        } catch (err) {
            console.error('Screen capture failed', err);
            isRecording = false;
            videoEl.play();
        }
    }
    function stopRecording() { if (!recorder) return; recorder.stop(); }

    if (recordBtn) {
        recordBtn.addEventListener('click', () => {
            if (isRecording) stopRecording(); else startRecording();
        });
    }

})();
