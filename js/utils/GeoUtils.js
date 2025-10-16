// GeoUtils.js
export function haversineDistanceMiles(p1, p2) {
    const R = 3958.8; // Earth radius in miles
    const lat1 = p1.lat * Math.PI / 180;
    const lat2 = p2.lat * Math.PI / 180;
    const dLat = lat2 - lat1;
    const dLon = (p2.lon - p1.lon) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
