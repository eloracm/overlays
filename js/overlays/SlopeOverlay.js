export class SlopeOverlay {
    constructor(parent, opts = {}, gpxManager) {
        this.canvas = document.createElement("canvas");
        this.canvas.width = 80;
        this.canvas.height = 120;
        Object.assign(this.canvas.style, {
            position: "absolute",
            left: opts.left || "0px",
            bottom: opts.bottom || "0px",
            width: "50px",
            height: "100px",
            background: "rgba(40,40,40,0.5)",
            borderRadius: "8px",
            zIndex: 2,
            pointerEvents: "none"
        });
        parent.appendChild(this.canvas);
        this.ctx = this.canvas.getContext("2d");
        this.slope = 0;

        this.gpx = gpxManager;

    }

    update(currentPoint) {
        if (!currentPoint) {
            return;
        }

        // Compute slope %
        let idx = 0;
        let minDiff = Infinity;
        for (let i = 0; i < this.gpx.points.length; i++) {
            const diff = Math.abs(this.gpx.points[i].time - currentPoint.timeMs);
            if (diff < minDiff) {
                minDiff = diff;
                idx = i;
            }
        }

        // --- Smooth slope computation ---
        const windowSize = 8; // use ±8 samples (~4s) for slope window
        let slope = 0;

        if (this.gpx.points.length > windowSize * 2) {
            let startIdx = Math.max(0, idx - windowSize);
            let endIdx = Math.min(this.gpx.points.length - 1, idx + windowSize);
            const p0 = this.gpx.points[startIdx];
            const p1 = this.gpx.points[endIdx];
            const distM = (p1.cumMiles - p0.cumMiles) * 1609.34;
            const elevDelta = p1.ele - p0.ele;
            slope = distM > 0 ? (elevDelta / distM) * 100 : 0;
        }

        // --- Apply exponential smoothing ---
        this.prevSlope = this.prevSlope ?? slope;
        const alpha = 0.15; // smaller = smoother
        slope = this.prevSlope = this.prevSlope * (1 - alpha) + slope * alpha;
        this.displaySlope = this.displaySlope ?? slope;
        this.displaySlope += (slope - this.displaySlope) * 0.2; // 20% easing per frame

        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        ctx.clearRect(0, 0, w, h);

        const maxSlope = 9.5; // ±12% display range
        const zeroY = h / 2;
        const clamped = Math.max(-maxSlope, Math.min(maxSlope, this.displaySlope));
        const barHeight = (Math.abs(clamped) / maxSlope) * (h / 2);

        // Map slope → 0–1 for interpolation
        const t = (clamped + maxSlope) / (2 * maxSlope); // 0 = steep down, 0.5 = flat, 1 = steep up

        // Darker greens for steeper downhills, darker reds for steeper uphills
        const downColor = this.interpolateColor("#00ff00", "#004400", 1 - t * 2); // light→dark green
        const upColor = this.interpolateColor("#ff9999", "#440000", (t - 0.5) * 2); // light→dark red

        // Create gradient that changes depending on slope direction
        const grad = ctx.createLinearGradient(0, h, 0, 0);
        if (clamped < 0) {
            // downhill dominant
            grad.addColorStop(0, "#004400");  // dark green
            grad.addColorStop(0.5, downColor);
            grad.addColorStop(1, "#ffff66");  // yellow top
        } else {
            // uphill dominant
            grad.addColorStop(0, "#ffff66");  // yellow bottom
            grad.addColorStop(0.5, upColor);
            grad.addColorStop(1, "#440000");  // dark red top
        }

        ctx.fillStyle = grad;
        const y = clamped >= 0 ? zeroY - barHeight : zeroY;
        ctx.fillRect(w / 4, y, w / 2, barHeight);

        // draw baseline and text
        ctx.strokeStyle = "white";
        ctx.beginPath();
        ctx.moveTo(0, zeroY);
        ctx.lineTo(w, zeroY);
        ctx.stroke();

        ctx.fillStyle = "#fff";
        ctx.font = "bold 20px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`${clamped.toFixed(1)}%`, w / 2, h - 2);
    }

    // === Helper for smooth color blending ===
    interpolateColor(c1, c2, t) {
        t = Math.max(0, Math.min(1, t));
        const parse = hex => hex.match(/\w\w/g).map(x => parseInt(x, 16));
        const [r1, g1, b1] = parse(c1);
        const [r2, g2, b2] = parse(c2);
        const r = Math.round(r1 + (r2 - r1) * t);
        const g = Math.round(g1 + (g2 - g1) * t);
        const b = Math.round(b1 + (b2 - b1) * t);
        return `rgb(${r},${g},${b})`;
    }
}
