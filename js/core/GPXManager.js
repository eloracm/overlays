// GPXManager.js (top)
let DOMParserImpl;
let fsPromises = null;

// Detect Node vs Browser
const isNode = typeof window === "undefined";

if (isNode) {
    const xmldom = await import("@xmldom/xmldom");
    DOMParserImpl = xmldom.DOMParser;
    fsPromises = await import("fs/promises");
} else {
    DOMParserImpl = DOMParser;
}


import { haversineDistanceMiles } from '../utils/GeoUtils.js'; // we'll define this helper below

export class GPXManager {
    constructor() {
        this.points = [];
        this.startMs = 0;
        this.endMs = 0;
        this.gpxStartOffsetMs = 0;
        this.gpxEndOffsetMs = 0;
        this.timeScale = 1.0; // multiply video time by this when mapping
    }


    setTimeOffset(seconds) {
        this.gpxStartOffsetMs = seconds * 1000;
        console.debug(`[GPXManager] Time offset set to ${seconds}s`);
    }

    setTimeScale(scale) {
        this.timeScale = scale;
        console.debug(`[GPXManager] Time scale set to ${scale}`);
    }

    async load(gpxUrl) {
        console.debug('[GPXManager] Loading GPX:', gpxUrl);
        let text;
        if (isNode && !/^https?:/i.test(gpxUrl)) {
            // Local file read in Node
            text = await fsPromises.readFile(gpxUrl, "utf8");
        } else {
            // Browser fetch
            const response = await fetch(gpxUrl);
            text = await response.text();
        }

        const parser = new DOMParserImpl();
        const xmlDoc = parser.parseFromString(text, 'application/xml');
        const trkptNodes = xmlDoc.getElementsByTagName('trkpt');
        const trkpts = Array.from(trkptNodes);

        this.points = trkpts.map(pt => {
            const lat = parseFloat(pt.getAttribute('lat'));
            const lon = parseFloat(pt.getAttribute('lon'));
            const ele = parseFloat(pt.getElementsByTagName('ele')[0]?.textContent || 0);
            const timeStr = pt.getElementsByTagName('time')[0]?.textContent;
            const time = new Date(timeStr).getTime();

            // --- Heart rate (Garmin / Strava GPX extension) ---
            // Look for <gpxtpx:hr> inside <extensions><gpxtpx:TrackPointExtension>
            const hrNode = pt.getElementsByTagName('gpxtpx:hr')[0];
            const hr = hrNode ? parseInt(hrNode.textContent) : null;
            return { lat, lon, ele, time, hr };
        });

        if (this.points.length < 2) {
            console.warn('[GPXManager] Not enough points.');
            return;
        }

        // Find the first point that has a valid timestamp
        const firstValidIndex = this.points.findIndex(pt => !isNaN(pt.time) && isFinite(pt.time));
        if (firstValidIndex > 0) {
            console.warn(`[GPXManager] Skipping ${firstValidIndex} points without timestamps.`);
            this.points = this.points.slice(firstValidIndex);
        }

        // Find the last valid timestamp (in case some at end are invalid)
        let lastValidIndex = this.points.length - 1;
        while (lastValidIndex >= 0 && (isNaN(this.points[lastValidIndex].time) || !isFinite(this.points[lastValidIndex].time))) {
            lastValidIndex--;
        }
        if (lastValidIndex < this.points.length - 1) {
            console.warn(`[GPXManager] Trimming ${this.points.length - 1 - lastValidIndex} points without timestamps at end.`);
            this.points = this.points.slice(0, lastValidIndex + 1);
        }

        // Verify again that we still have enough points
        if (this.points.length < 2) {
            console.warn('[GPXManager] Not enough valid timestamped points after trimming.');
            return;
        }
        this.startMs = this.points[firstValidIndex].time;
        this.endMs = this.points[lastValidIndex].time;

        // === compute cumulative miles using adjacent segments (true path length) ===
        let cumMiles = 0;
        this.points[0].cumMiles = 0;
        this.points[0].speedMph = 0;

        // adjacent distance loop (accurate path length)
        for (let i = 1; i < this.points.length; i++) {
            const prev = this.points[i - 1];
            const curr = this.points[i];

            const distMi = haversineDistanceMiles(prev, curr);
            cumMiles += distMi;
            curr.cumMiles = cumMiles;

            // initialize speed to 0 here; we'll compute realistic speeds in a separate pass
            curr.speedMph = 0;
        }

        // === compute realistic instantaneous speed using >=1s windows (no effect on cumMiles) ===
        for (let i = 1; i < this.points.length; i++) {
            const curr = this.points[i];

            // find previous point at least ~1 second earlier
            let j = i - 1;
            while (j > 0 && (curr.time - this.points[j].time) < 1000) j--;

            const prev = this.points[j];

            const distMi = haversineDistanceMiles(prev, curr);
            const dtHr = (curr.time - prev.time) / (1000 * 3600);

            const mph = dtHr > 0 ? distMi / dtHr : 0;
            curr.speedMph = mph;
        }

        // cumMiles variable now contains the true total distance along adjacent segments
        // Keep it for debug printing below (the rest of the function remains unchanged)

        // ✅ Smooth speed (5-point moving average)
        const rawSpeeds = this.points.map(p => p.speedMph);
        const smoothed = this._smoothSeries(rawSpeeds, 5);
        this.points.forEach((p, i) => (p.speedMph = smoothed[i]));

        // ✅ Debug stats
        const avgRaw = rawSpeeds.reduce((a, b) => a + b, 0) / rawSpeeds.length;
        const avgSmooth = smoothed.reduce((a, b) => a + b, 0) / smoothed.length;
        const maxRaw = Math.max(...rawSpeeds);
        const maxSmooth = Math.max(...smoothed);
        const durationHrs = (this.endMs - this.startMs) / (1000 * 3600);

        console.debug(`[GPXManager] Loaded ${this.points.length} points`);
        console.debug(`[GPXManager] Total distance: ${cumMiles.toFixed(2)} mi`);
        console.debug(`[GPXManager] Duration: ${durationHrs.toFixed(2)} h`);
        console.debug(`[GPXManager] Avg raw speed: ${avgRaw.toFixed(2)} mph`);
        console.debug(`[GPXManager] Max raw speed: ${maxRaw.toFixed(2)} mph`);
        console.debug(`[GPXManager] Avg smoothed speed: ${avgSmooth.toFixed(2)} mph`);
        console.debug(`[GPXManager] Max smoothed speed: ${maxSmooth.toFixed(2)} mph`);

        // === GPX timestamp diagnostics ===
        if (this.points.length > 2) {
            console.group("[GPXManager] Timestamp diagnostics");

            const pts = this.points;
            const firstTen = pts.slice(0, 10);
            const lastTen = pts.slice(-10);

            console.log("First 10 points:");
            firstTen.forEach((p, i) => {
                if (i > 0) {
                    const dt = (p.time - firstTen[i - 1].time) / 1000;
                    console.log(
                        `${i}: ${p.timeString}  Δt=${dt.toFixed(3)}s`
                    );
                } else {
                    console.log(`${i}: ${p.timeString}`);
                }
            });

            console.log("\nLast 10 points:");
            lastTen.forEach((p, i) => {
                if (i > 0) {
                    const dt = (p.time - lastTen[i - 1].time) / 1000;
                    console.log(
                        `${pts.length - 10 + i}: ${p.timeString}  Δt=${dt.toFixed(3)}s`
                    );
                } else {
                    console.log(`${pts.length - 10 + i}: ${p.timeString}`);
                }
            });

            const totalSec = (pts[pts.length - 1].time - pts[0].time) / 1000;
            console.log(`\nTotal elapsed: ${totalSec.toFixed(1)} s (${(totalSec / 60).toFixed(2)} min)`);

            console.groupEnd();

            // === Speed histogram diagnostics ===
            {
                const speeds = this.points.map(p => p.speedMph).filter(s => isFinite(s) && s > 0);
                const binSize = 2; // mph per bin
                const maxSpeed = Math.max(...speeds);
                const bins = new Array(Math.ceil(maxSpeed / binSize)).fill(0);
                speeds.forEach(s => bins[Math.min(bins.length - 1, Math.floor(s / binSize))]++);
                const peakBin = bins.indexOf(Math.max(...bins)) * binSize;
                const median = speeds.sort((a, b) => a - b)[Math.floor(speeds.length / 2)];

                console.group("[GPXManager] Speed histogram");
                console.log(`Median: ${median.toFixed(1)} mph`);
                bins.forEach((count, i) => {
                    const range = `${(i * binSize).toFixed(0)}-${((i + 1) * binSize).toFixed(0)} mph`;
                    const bar = "█".repeat(Math.round((count / Math.max(...bins)) * 40));
                    console.log(`${range.padStart(8)} | ${bar}`);
                });
                console.groupEnd();
            }
            // --- Robust speed statistics and suggested gauge max ---
            // Robust suggested gauge max (replace previous computation)
            const OUTLIER_SPEED_CAP_MPH = 40; // tuneable: 60-80 is good for most cycling
            const MIN_GAUGE = 8;             // minimum gauge (mph) to keep dial usable

            const speeds = this.points
                .map(p => p.speedMph)
                .filter(s => isFinite(s) && s > 0);

            if (speeds.length === 0) {
                this.suggestedMaxMph = 30;
            } else {
                // Filter out extreme spikes for statistics
                const filtered = speeds.filter(s => s <= OUTLIER_SPEED_CAP_MPH);

                // Simple median helper
                function median(arr) {
                    const a = arr.slice().sort((x, y) => x - y);
                    const n = a.length;
                    if (!n) return 0;
                    return (n % 2) ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
                }

                // Percentile helper
                function percentile(arr, p) {
                    if (!arr.length) return 0;
                    const a = arr.slice().sort((x, y) => x - y);
                    const idx = (p / 100) * (a.length - 1);
                    const lo = Math.floor(idx), hi = Math.ceil(idx);
                    if (lo === hi) return a[lo];
                    const t = idx - lo;
                    return a[lo] * (1 - t) + a[hi] * t;
                }

                const med = median(filtered);
                const p98 = percentile(filtered, 98);
                const p99 = percentile(filtered, 99);

                // Smoothed series for peak detection (use your existing smoothing helper)
                const smoothed = this._smoothSeries(filtered, 5).filter(s => isFinite(s) && s > 0 && s <= OUTLIER_SPEED_CAP_MPH);
                const rawSmoothedMax = smoothed.length ? Math.max(...smoothed) : 0;

                // Candidate values from robust measures
                const cand_p98 = p98 * 1.25;         // slight headroom over sustained near-peak
                const cand_median = Math.max(p99 * 1.05, med * 2.0); // allow median*2 or tiny headroom over p99
                const cand_p99_plus = p99 + 5.0;     // small absolute headroom over extreme-but-real values

                // Decide whether to trust rawSmoothedMax:
                // if rawSmoothedMax is more than 2x p99 it's likely outlier-affected; ignore it.
                let includeRawSmoothed = (rawSmoothedMax > 0 && rawSmoothedMax <= p99 * 2.0);
                let cand_raw = includeRawSmoothed ? rawSmoothedMax : 0;

                // final candidate is the max of the robust candidates (and raw if allowed)
                let candidate = Math.max(cand_p98, cand_median, cand_p99_plus, cand_raw);

                // Guard against absurd tiny candidate; enforce a reasonable floor
                candidate = Math.max(candidate, MIN_GAUGE);

                // Round up to nearest 5 mph and give 2 mph headroom
                let computed = Math.ceil((candidate + 2) / 5) * 5;

                // Optional user-configurable cap — remove or set high if you don't want a hard cap
                const USER_CAP = this.maxCapMph || 999; // default effectively no cap
                computed = Math.min(computed, USER_CAP);

                this.suggestedMaxMph = computed;

                console.debug(`[GPXManager] Speed stats rawMax=${Math.max(...speeds).toFixed(1)} ` +
                    `med=${med.toFixed(1)} p98=${p98.toFixed(1)} p99=${p99.toFixed(1)} ` +
                    `rawSmoothedMax=${rawSmoothedMax.toFixed(1)} includeRaw=${includeRawSmoothed} ` +
                    `candidate=${candidate.toFixed(2)} computed=${this.suggestedMaxMph}`);
            }

        }
        console.debug(`[GPXManager] Suggested speedometer max: ${this.suggestedMaxMph} mph`);
    }

    getDurationMs() {
        return this.endMs - this.startMs;
    }

    _smoothSeries(values, windowSize = 5) {
        const half = Math.floor(windowSize / 2);
        const result = new Array(values.length);
        for (let i = 0; i < values.length; i++) {
            let sum = 0, count = 0;
            for (let j = i - half; j <= i + half; j++) {
                if (j >= 0 && j < values.length) {
                    sum += values[j];
                    count++;
                }
            }
            result[i] = sum / count;
        }
        return result;
    }

    getInterpolatedPoint(videoAbsoluteMs) {
        if (!this.points.length) return null;
        const targetMs = videoAbsoluteMs + (this.gpxStartOffsetMs || 0);

        if (targetMs <= this.startMs) return this.points[0];
        if (targetMs >= this.endMs) return this.points[this.points.length - 1];

        let left = 0;
        let right = this.points.length - 1;
        while (right - left > 1) {
            const mid = (left + right) >> 1;
            if (this.points[mid].time < targetMs) left = mid;
            else right = mid;
        }

        const p1 = this.points[left];
        const p2 = this.points[right];
        const span = p2.time - p1.time;
        const ratio = span > 0 ? (targetMs - p1.time) / span : 0;

        return {
            lat: p1.lat + (p2.lat - p1.lat) * ratio,
            lon: p1.lon + (p2.lon - p1.lon) * ratio,
            ele: p1.ele + (p2.ele - p1.ele) * ratio,
            timeMs: targetMs,
            miles: p1.cumMiles + (p2.cumMiles - p1.cumMiles) * ratio,
            speedMph: p1.speedMph + (p2.speedMph - p1.speedMph) * ratio,
            hr: p1.hr + (p2.hr - p1.hr) * ratio,
            idxLeft: left,
            idxRight: right,
            ratio,
        };
    }
}