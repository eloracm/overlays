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

        // ✅ Compute cumulative miles + instantaneous speed
        let cumMiles = 0;
        this.points[0].cumMiles = 0;
        this.points[0].speedMph = 0;

        for (let i = 1; i < this.points.length; i++) {
            const prev = this.points[i - 1];
            const curr = this.points[i];

            const distMi = haversineDistanceMiles(prev, curr);
            const dtHr = (curr.time - prev.time) / (1000 * 3600);

            cumMiles += distMi;
            curr.cumMiles = cumMiles;

            const mph = dtHr > 0 ? distMi / dtHr : 0;
            curr.speedMph = mph;
        }

        // ✅ Smooth speed (5-point moving average)
        const smoothed = this._smoothSeries(this.points.map(p => p.speedMph), 5);
        this.points.forEach((p, i) => (p.speedMph = smoothed[i]));

        console.debug(`[GPXManager] Loaded ${this.points.length} points, total distance: ${cumMiles.toFixed(2)} mi`);
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