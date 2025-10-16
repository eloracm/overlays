export class MapStaticOverlay {
    constructor(id, gpxManager) {
        this.gpxManager = gpxManager;
        this.container = document.getElementById(id);

        const coords = this.gpxManager.points.map(p => [p.lat, p.lon]);
        if (coords.length < 2) return;

        // Compute bounding box
        const lats = coords.map(c => c[0]);
        const lons = coords.map(c => c[1]);
        const latSpan = Math.max(...lats) - Math.min(...lats);
        const lonSpan = Math.max(...lons) - Math.min(...lons);

        // Determine map shape based on route orientation
        const isVertical = latSpan > lonSpan;

        // Set size dynamically (container is positioned in CSS)
        const width = isVertical ? 220 : 330;
        const height = isVertical ? 330 : 220;
        this.container.style.width = `${width}px`;
        this.container.style.height = `${height}px`;

        // Initialize Leaflet map
        this.map = L.map(this.container, {
            zoomControl: false,
            attributionControl: false,
            dragging: false,
            scrollWheelZoom: false,
            doubleClickZoom: false,
            boxZoom: false,
            keyboard: false,
            tap: false,
            zoomSnap: 0.1,
            zoomDelta: 0.1,
            zoom: 15,
        });

        // MapTiler Streets base layer
        L.tileLayer(
            'https://api.maptiler.com/maps/streets/{z}/{x}/{y}.png?key=JuhguwTa9FSypu7pKgm9',
            {
                tileSize: 512,
                zoomOffset: -1,
                attribution:
                    '&copy; <a href="https://www.maptiler.com/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors'
            }
        ).addTo(this.map);

        // Full route (dark gray)
        this.routeFull = L.polyline(coords, {
            color: "#444",
            weight: 4,
            opacity: 0.7,
        }).addTo(this.map);

        // Traveled route (medium blue)
        this.routeTraveled = L.polyline([], {
            color: "#3A9BDC",
            weight: 4,
            opacity: 0.9,
        }).addTo(this.map);

        // Current position marker (red circle with white outline)
        this.currentMarker = L.circleMarker(coords[0], {
            radius: 7,
            color: "#fff",
            fillColor: "#FF3030",
            fillOpacity: 1.0,
            weight: 2,
        }).addTo(this.map);

        // Fit the map to bounds with a small padding
        this.map.fitBounds(this.routeFull.getBounds(), { padding: [10, 10] });
    }

    update(currentPoint) {
        if (!currentPoint) return;

        const pts = this.gpxManager.points;
        let idx = pts.findIndex(p => p.time >= currentPoint.time);
        if (idx < 0) idx = pts.length - 1;

        const traveledCoords = pts.slice(0, idx + 1).map(p => [p.lat, p.lon]);
        this.routeTraveled.setLatLngs(traveledCoords);

        const { lat, lon } = currentPoint;
        if (lat && lon) {
            this.currentMarker.setLatLng([lat, lon]);
        }
    }
}
