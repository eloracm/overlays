export class MapStaticOverlay {
    constructor(id, gpxManager) {
        this.gpxManager = gpxManager;
        this.container = document.getElementById(id);

        const coords = this.gpxManager.points.map(p => [p.lat, p.lon]);
        if (coords.length < 2) return;

        // Map setup
        const lats = coords.map(c => c[0]);
        const lons = coords.map(c => c[1]);
        const latSpan = Math.max(...lats) - Math.min(...lats);
        const lonSpan = Math.max(...lons) - Math.min(...lons);
        const isVertical = latSpan > lonSpan;

        const width = isVertical ? 220 : 330;
        const height = isVertical ? 330 : 220;
        this.container.style.width = `${width}px`;
        this.container.style.height = `${height}px`;

        this.map = L.map(this.container, {
            zoomControl: false,
            attributionControl: false,
            dragging: false,
            scrollWheelZoom: false,
            doubleClickZoom: false,
            boxZoom: false,
            keyboard: false,
            tap: false,
        });

        L.tileLayer(
            'https://api.maptiler.com/maps/streets/{z}/{x}/{y}.png?key=JuhguwTa9FSypu7pKgm9',
            {
                tileSize: 512,
                zoomOffset: -1,
                attribution:
                    '&copy; <a href="https://www.maptiler.com/">MapTiler</a> © <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors',
            }
        ).addTo(this.map);

        // Full (dark gray) route
        this.routeFull = L.polyline(coords, {
            color: "#444",
            weight: 4,
            opacity: 0.8,
        }).addTo(this.map);

        // Traveled (blue) route starts empty
        this.routeTraveled = L.polyline([], {
            color: "#3A9BDC",
            weight: 4,
            opacity: 1.0,
        }).addTo(this.map);

        // Current marker
        this.currentMarker = L.circleMarker(coords[0], {
            radius: 7,
            color: "#fff",
            fillColor: "#FF3030",
            fillOpacity: 1.0,
            weight: 2,
        }).addTo(this.map);

        this.map.fitBounds(this.routeFull.getBounds(), { padding: [10, 10] });

        this.started = false;
    }

    update(currentPoint, _) {
        if (!currentPoint) return;

        const pts = this.gpxManager.points;
        if (!pts?.length) return;

        const timeMs = currentPoint.timeMs;
        const startMs = this.gpxManager.startMs;
        const endMs = this.gpxManager.endMs;

        // If we're before the first valid timestamp, show only the marker at the start
        if (timeMs < startMs) {
            this.routeTraveled.setLatLngs([]);
            this.currentMarker.setLatLng([pts[0].lat, pts[0].lon]);
            return;
        }

        // If we're past the end, draw full blue route
        if (timeMs >= endMs) {
            this.routeTraveled.setLatLngs(pts.map(p => [p.lat, p.lon]));
            this.currentMarker.setLatLng([pts[pts.length - 1].lat, pts[pts.length - 1].lon]);
            return;
        }

        // Find the index of the last GPX point whose time <= current time
        let idx = pts.findIndex(p => p.time > timeMs);
        if (idx > 0) {
            idx -= 1;
        }

        // Draw traveled section up to current index
        const traveledCoords = pts.slice(0, idx + 1).map(p => [p.lat, p.lon]);
        this.routeTraveled.setLatLngs(traveledCoords);

        // // Interpolate marker position between pts[idx] and pts[idx+1]
        // const a = pts[idx];
        // const b = pts[idx + 1] || a;
        // const t = (timeMs - a.time) / (b.time - a.time || 1);
        // const interpLat = a.lat + (b.lat - a.lat) * Math.max(0, Math.min(1, t));
        // const interpLon = a.lon + (b.lon - a.lon) * Math.max(0, Math.min(1, t));
        // this.currentMarker.setLatLng([interpLat, interpLon]);

        // Move marker
        const { lat, lon } = currentPoint;
        if (lat && lon) this.currentMarker.setLatLng([lat, lon]);
    }
}
