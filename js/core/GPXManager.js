// js/core/GPXManager.js
import { parseGPX } from "../utils/MathUtils.js";

export class GPXManager {
    constructor() {
        this.points = [];
        this.startMs = 0;
        this.endMs = 0;
        this.durationMs = 0;
        this.totalMiles = 0;
    }

    async load(gpxUrl) {
        console.log("[GPXManager] Loading GPX:", gpxUrl);
        const response = await fetch(gpxUrl);
        const xmlText = await response.text();
        const parser = new DOMParser();
        const xml = parser.parseFromString(xmlText, "application/xml");

        // Parse <trkpt> elements and correctly handle local timestamps
        // Parse <trkpt> elements and correctly handle UTC → local conversion
        const trkpts = Array.from(xml.getElementsByTagName("trkpt"));
        this.points = trkpts.map(pt => {
            const lat = parseFloat(pt.getAttribute("lat"));
            const lon = parseFloat(pt.getAttribute("lon"));
            const ele = parseFloat(pt.querySelector("ele")?.textContent || "0");

            const timeText = pt.querySelector("time")?.textContent || "";
            let timeMs = NaN;

            if (timeText) {
                // Convert UTC (Z-suffixed) GPX times into *local* time milliseconds
                const utc = new Date(timeText).getTime();
                // const local = utc - new Date().getTimezoneOffset() * 60000;
                timeMs = utc;
            }

            return { lat, lon, ele, time: timeMs };
        });


        if (this.points.length > 1) {
            this._computeCumulativeMiles();
            this.startMs = this.points[0].time;
            this.endMs = this.points[this.points.length - 1].time;
            this.durationMs = this.endMs - this.startMs;
            this.totalMiles = this.points[this.points.length - 1].cumMiles;
        }

        if (window.DEBUG) {
            console.log(
                `[GPXManager] Loaded ${this.points.length} points`,
                `Start: ${new Date(this.startMs).toISOString()}`,
                `End: ${new Date(this.endMs).toISOString()}`,
                `Total miles: ${this.totalMiles.toFixed(2)}`
            );
        }
    }

    /**
     * Compute cumulative miles for each point using haversine formula.
     */
    _computeCumulativeMiles() {
        const R = 6371000; // meters
        const toRad = deg => (deg * Math.PI) / 180;

        let totalMeters = 0;
        this.points[0].cumMiles = 0;

        for (let i = 1; i < this.points.length; i++) {
            const p0 = this.points[i - 1];
            const p1 = this.points[i];

            const dLat = toRad(p1.lat - p0.lat);
            const dLon = toRad(p1.lon - p0.lon);
            const a =
                Math.sin(dLat / 2) ** 2 +
                Math.cos(toRad(p0.lat)) *
                Math.cos(toRad(p1.lat)) *
                Math.sin(dLon / 2) ** 2;
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

            totalMeters += R * c;
            p1.cumMiles = totalMeters / 1609.34; // convert to miles
        }
    }

    /**
     * Interpolates telemetry at a given timestamp (ms).
     */
    getInterpolatedPoint(targetMs) {
        if (!this.points.length) return null;
        if (targetMs <= this.startMs) return this.points[0];
        if (targetMs >= this.endMs) return this.points[this.points.length - 1];

        // Binary search
        let left = 0;
        let right = this.points.length - 1;
        while (right - left > 1) {
            const mid = Math.floor((left + right) / 2);
            if (this.points[mid].time < targetMs) left = mid;
            else right = mid;
        }

        const p1 = this.points[left];
        const p2 = this.points[right];
        const ratio = (targetMs - p1.time) / (p2.time - p1.time);

        return {
            lat: p1.lat + (p2.lat - p1.lat) * ratio,
            lon: p1.lon + (p2.lon - p1.lon) * ratio,
            ele: p1.ele + (p2.ele - p1.ele) * ratio,
            timeMs: targetMs,
            miles: p1.cumMiles + (p2.cumMiles - p1.cumMiles) * ratio,
            idxLeft: left,
            idxRight: right,
            ratio,
        };
    }
}
