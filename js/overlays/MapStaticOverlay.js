// /js/overlays/MapStaticOverlay.js
export class MapStaticOverlay {
    constructor(containerId, gpxManager) {
        this.container = document.getElementById(containerId);
        this.gpxManager = gpxManager;
        this.map = null;
        this.routeLine = null;
        this.traveledLine = null;

        this._initMap();
    }

    _initMap() {
        if (!this.container) {
            console.error("[MapStaticOverlay] Missing container element");
            return;
        }

        // Create the Leaflet map
        this.map = L.map(this.container, {
            attributionControl: false,
            zoomControl: false,
            dragging: false,
            scrollWheelZoom: false,
            doubleClickZoom: false,
            boxZoom: false,
            keyboard: false,
            zoomSnap: 0.1,
            zoomDelta: 0.1,
            inertia: false,
        });

        // ✅ Add base map tiles (this was missing earlier)
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
        }).addTo(this.map);

        // ✅ Initialize GPX route
        const points = this.gpxManager?.points || [];
        if (points.length > 1) {
            const latlngs = points.map(p => [p.lat, p.lon]);
            this.routeLine = L.polyline(latlngs, {
                color: "#FFD700",
                weight: 3,
                opacity: 0.8,
            }).addTo(this.map);

            this.traveledLine = L.polyline([], {
                color: "#00FFAA",
                weight: 4,
                opacity: 0.9,
            }).addTo(this.map);

            this.map.fitBounds(this.routeLine.getBounds());
        }

        // ✅ Fix rendering bug: ensure the map resizes correctly
        setTimeout(() => this.map.invalidateSize(), 250);

        // ✅ Apply background styling
        this.container.style.background = "rgba(80,80,80,0.35)";
        this.container.style.borderRadius = "12px";
        this.container.style.overflow = "hidden";
        this.container.style.zIndex = 2;
    }

    update(currentPoint, _) {
        if (!this.map || !this.gpxManager || !currentPoint) return;

        const points = this.gpxManager.points;
        if (!points || points.length < 2) return;

        const cutoffIndex = Math.min(points.length - 1, currentPoint.idxRight || 0);
        const traveledLatLngs = points.slice(0, cutoffIndex + 1).map(p => [p.lat, p.lon]);

        if (this.traveledLine) {
            this.traveledLine.setLatLngs(traveledLatLngs);
        }
    }
}
