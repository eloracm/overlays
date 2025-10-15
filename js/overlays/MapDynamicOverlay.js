// js/overlays/MapDynamicOverlay.js
import { bearingBetweenDeg } from "../utils/MathUtils.js";

export class MapDynamicOverlay {
    constructor(containerId, gpxManager) {
        this.map = L.map(containerId, {
            zoomControl: false,
            attributionControl: false,
            dragging: false,
            scrollWheelZoom: false,
            doubleClickZoom: false
        });
        this.arrow = null;
        this.lastHeading = 0;
        this.gpx = gpxManager;

        const routeCoords = gpxManager.points.map(p => [p.lat, p.lon]);
        if (routeCoords.length > 1) {
            this.routeLine = L.polyline(routeCoords, { color: '#FFD700', weight: 3 }).addTo(this.map);
            this.map.fitBounds(this.routeLine.getBounds());
        }

        setTimeout(() => this.map.invalidateSize(), 0);
    }

    init(startLat, startLon) {
        this.map.setView([startLat, startLon], 16);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(this.map);

        const arrowSvg = `
            <svg width="40" height="40" viewBox="0 0 40 40">
                <polygon points="20,4 32,36 20,28 8,36" fill="#FFD700" />
            </svg>`;
        const icon = L.divIcon({
            html: arrowSvg,
            className: "",
            iconSize: [40, 40],
            iconAnchor: [20, 20]
        });

        this.arrow = L.marker([startLat, startLon], { icon }).addTo(this.map);
    }

    update(point, _) {
        if (!point?.lat) return;
        this.arrow.setLatLng([point.lat, point.lon]);
        this.map.panTo([point.lat, point.lon], { animate: false });

        const { idxLeft, idxRight } = point;
        const p1 = this.gpx.points[idxLeft];
        const p2 = this.gpx.points[idxRight];
        if (!p1 || !p2) return;

        const heading = bearingBetweenDeg(p1, p2);
        const diff = ((heading - this.lastHeading + 540) % 360) - 180;
        this.lastHeading = (this.lastHeading + 0.2 * diff + 360) % 360;

        const el = this.arrow.getElement()?.querySelector("svg");
        if (el) el.style.transform = `rotate(${this.lastHeading}deg)`;
    }
}
