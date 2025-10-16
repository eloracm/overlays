import { haversineDistanceMiles } from '../utils/GeoUtils.js'; // we'll define this helper below

export class GPXManager {
    constructor() {
        this.points = [];
        this.startMs = 0;
        this.endMs = 0;
        this.videoToGpxOffsetMs = 0;
    }

    async load(gpxUrl) {
        console.debug('[GPXManager] Loading GPX:', gpxUrl);
        const response = await fetch(gpxUrl);
        const text = await response.text();

        const parser = new DOMParser();
        const xml = parser.parseFromString(text, 'application/xml');
        const trkpts = [...xml.getElementsByTagName('trkpt')];

        this.points = trkpts.map(pt => {
            const lat = parseFloat(pt.getAttribute('lat'));
            const lon = parseFloat(pt.getAttribute('lon'));
            const ele = parseFloat(pt.querySelector('ele')?.textContent || 0);
            const timeStr = pt.querySelector('time')?.textContent;
            const time = new Date(timeStr).getTime();
            return { lat, lon, ele, time };
        });

        if (this.points.length < 2) {
            console.warn('[GPXManager] Not enough points.');
            return;
        }

        this.startMs = this.points[0].time;
        this.endMs = this.points[this.points.length - 1].time;

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
            // === Auto gauge range suggestion (95th percentile, but ensure we catch top bursts) ===
            const sorted = [...smoothed].sort((a, b) => a - b);
            const p98 = sorted[Math.floor(sorted.length * 0.98)]; // use 98th percentile
            const maxVal = Math.max(p98, Math.max(...smoothed)); // cover small outliers
            // round up to nearest 5 mph, with at least +2 mph of headroom
            this.suggestedMaxMph = Math.max(20, Math.ceil((maxVal + 2) / 5) * 5);
            console.debug(`[GPXManager] Suggested speedometer max: ${this.suggestedMaxMph} mph`);
        }

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
        const targetMs = videoAbsoluteMs + (this.videoToGpxOffsetMs || 0);

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
            idxLeft: left,
            idxRight: right,
            ratio,
        };
    }
}