// js/utils/MathUtils.js

/**
 * Bearing between two GPS points in degrees (0° = north, clockwise).
 */
export function bearingBetweenDeg(p1, p2) {
    const toRad = deg => (deg * Math.PI) / 180;
    const toDeg = rad => (rad * 180) / Math.PI;

    const lat1 = toRad(p1.lat);
    const lat2 = toRad(p2.lat);
    const dLon = toRad(p2.lon - p1.lon);

    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) -
        Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Simple linear interpolation helper.
 */
export function lerp(a, b, t) {
    return a + (b - a) * t;
}

/**
 * Optional GPX parser utility (if needed standalone).
 */
export function parseGPX(xml) {
    const trkpts = Array.from(xml.getElementsByTagName("trkpt"));
    return trkpts.map(pt => ({
        lat: parseFloat(pt.getAttribute("lat")),
        lon: parseFloat(pt.getAttribute("lon")),
        ele: parseFloat(pt.querySelector("ele")?.textContent || "0"),
        time: new Date(pt.querySelector("time")?.textContent).getTime()
    }));
}
