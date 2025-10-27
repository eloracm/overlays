
// Only import 'canvas' when running in Node
let createCanvas = null;
if (typeof window === "undefined") {
    // Dynamically import at runtime so browser never sees it
    const mod = await import("canvas");
    createCanvas = mod.createCanvas;
}

export class ElevationOverlay {
    constructor(canvasId, gpxManager) {

        // Detect environment: browser or Node
        const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";

        if (isBrowser) {
            // Normal browser usage
            this.canvas = document.getElementById(canvasId);
        } else {
            // Headless Node rendering
            this.canvas = createCanvas(3840, 2160);
        }

        this.ctx = this.canvas.getContext("2d");
        this.gpx = gpxManager;

        // Internal 4K resolution, scaled display
        this.canvas.width = 3840;
        this.canvas.height = 2160;

        if (isBrowser) {
            this.canvas.style.width = "1200px";
            this.canvas.style.height = "180px";
            // Scale context for drawing in visible coordinates
            const scaleX = this.canvas.width / parseInt(this.canvas.style.width);
            const scaleY = this.canvas.height / parseInt(this.canvas.style.height);
            this.ctx.scale(scaleX, scaleY);
        }
    }

    update(currentPoint, currentTargetTimeMs) {
        const ctx = this.ctx;
        const visibleW = 1200 /*parseInt(this.canvas.style.width) */;
        const visibleH = 180 /* parseInt(this.canvas.style.height) */;
        const points = this.gpx.points;
        if (!points || points.length < 2) return;

        const minEle = Math.min(...points.map(p => p.ele));
        const maxEle = Math.max(...points.map(p => p.ele));
        const totalMiles = points[points.length - 1].cumMiles;

        const minEleFt = minEle * 3.28084;
        const maxEleFt = maxEle * 3.28084;
        const eleRange = Math.max(1, maxEleFt - minEleFt);
        const totalMilesSafe = Math.max(totalMiles, 0.01);

        const margin = { left: 60, right: 40, top: 20, bottom: 36 };
        const gxL = margin.left,
            gxR = visibleW - margin.right,
            gxT = margin.top,
            gxB = visibleH - margin.bottom;
        const graphH = gxB - gxT;

        ctx.clearRect(0, 0, visibleW, visibleH);

        // === filled area ===
        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
            const x = gxL + (points[i].cumMiles / totalMilesSafe) * (gxR - gxL);
            const y = gxB - ((points[i].ele * 3.28084 - minEleFt) / eleRange) * graphH;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.lineTo(gxR, gxB);
        ctx.lineTo(gxL, gxB);
        ctx.closePath();
        ctx.fillStyle = "rgba(0,188,212,0.22)";
        ctx.fill();

        // === colored slope segments ===
        for (let i = 1; i < points.length; i++) {
            const p0 = points[i - 1], p1 = points[i];
            const distM = (p1.cumMiles - p0.cumMiles) * 1609.34;
            const elevDelta = p1.ele - p0.ele;
            const slope = distM > 0 ? (elevDelta / distM) * 100 : 0;
            let color = "#ffffff";
            if (slope < -.5) color = "#00ff88";
            else if (slope < .5) color = "#ffffff";
            else if (slope < 3) color = "#ff9933";
            else color = "#ff3333";
            const x1 = gxL + (p0.cumMiles / totalMilesSafe) * (gxR - gxL);
            const y1 = gxB - ((p0.ele * 3.28084 - minEleFt) / eleRange) * graphH;
            const x2 = gxL + (p1.cumMiles / totalMilesSafe) * (gxR - gxL);
            const y2 = gxB - ((p1.ele * 3.28084 - minEleFt) / eleRange) * graphH;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.strokeStyle = color;
            ctx.lineWidth = 3;
            ctx.stroke();
        }

        // === axes & ticks ===
        ctx.strokeStyle = "rgba(255,255,255,0.5)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        // ctx.moveTo(gxL, gxB);
        // ctx.lineTo(gxR, gxB);
        // ctx.lineTo(gxR, gxT);
        // ctx.stroke();

        // === axes & ticks ===
        ctx.strokeStyle = "rgba(255,255,255,0.5)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(gxL, gxB); // bottom axis
        ctx.lineTo(gxR, gxB); // only bottom line (no right vertical)
        ctx.moveTo(gxL, gxB);
        ctx.lineTo(gxL, gxT); // left vertical
        ctx.stroke();

        // === labels ===
        ctx.fillStyle = "#fff";
        ctx.font = "bold 14px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Distance (mi)", (gxL + gxR) / 2, visibleH - 6);

        ctx.save();
        ctx.translate(14, (gxT + gxB) / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText("Elevation (ft)", 0, 0);
        ctx.restore();

        ctx.fillStyle = "#fff";
        ctx.font = "12px sans-serif";
        ctx.textAlign = "center";

        // X ticks (distance in miles)
        const xTicks = 5;
        for (let i = 0; i <= xTicks; i++) {
            const ratio = i / xTicks;
            const x = gxL + ratio * (gxR - gxL);
            const miles = totalMilesSafe * ratio;
            ctx.beginPath();
            ctx.moveTo(x, gxB);
            ctx.lineTo(x, gxB + 4);
            ctx.stroke();
            ctx.fillText(miles.toFixed(1), x, gxB + 14);
        }

        // Y ticks (elevation in feet)
        ctx.textAlign = "right";
        const yTicks = 5;
        for (let i = 0; i <= yTicks; i++) {
            const ratio = i / yTicks;
            const y = gxB - ratio * graphH;
            const eleFt = Math.round(minEleFt + ratio * eleRange);
            ctx.beginPath();
            ctx.moveTo(gxL - 4, y);
            ctx.lineTo(gxL, y);
            ctx.stroke();
            ctx.fillText(eleFt, gxL - 8, y + 3);
        }

        // === current marker with slope visuals ===
        if (currentPoint) {
            const markerX = gxL + (currentPoint.cumMiles || currentPoint.miles / totalMilesSafe) * (gxR - gxL);
            const markerY = gxB - ((currentPoint.ele * 3.28084 - minEleFt) / eleRange) * graphH;

            // // Compute slope %
            // let idx = 0;
            // let minDiff = Infinity;
            // for (let i = 0; i < this.gpx.points.length; i++) {
            //     const diff = Math.abs(this.gpx.points[i].time - currentPoint.timeMs);
            //     if (diff < minDiff) {
            //         minDiff = diff;
            //         idx = i;
            //     }
            // }

            // // --- Smooth slope computation ---
            // const windowSize = 8; // use ±8 samples (~4s) for slope window
            // let slope = 0;

            // if (this.gpx.points.length > windowSize * 2) {
            //     let startIdx = Math.max(0, idx - windowSize);
            //     let endIdx = Math.min(this.gpx.points.length - 1, idx + windowSize);
            //     const p0 = this.gpx.points[startIdx];
            //     const p1 = this.gpx.points[endIdx];
            //     const distM = (p1.cumMiles - p0.cumMiles) * 1609.34;
            //     const elevDelta = p1.ele - p0.ele;
            //     slope = distM > 0 ? (elevDelta / distM) * 100 : 0;
            // }

            // // --- Apply exponential smoothing ---
            // this.prevSlope = this.prevSlope ?? slope;
            // const alpha = 0.15; // smaller = smoother
            // slope = this.prevSlope = this.prevSlope * (1 - alpha) + slope * alpha;
            // this.displaySlope = this.displaySlope ?? slope;
            // this.displaySlope += (slope - this.displaySlope) * 0.2; // 20% easing per frame

            // --- Marker circle ---
            ctx.beginPath();
            ctx.arc(markerX, markerY, 5, 0, Math.PI * 2);
            ctx.fillStyle = "red";
            ctx.fill();

            // --- Elevation label ---
            ctx.font = "bold 12px sans-serif";
            ctx.textAlign = "center";
            ctx.fillStyle = "white";
            ctx.fillText(`${Math.round(currentPoint.ele * 3.28084)} ft, `, markerX, markerY - 12);

            // // --- Slope color gradient ---
            // const grad = ctx.createLinearGradient(markerX - 20, markerY, markerX + 20, markerY);
            // if (slope < 0) {
            //     grad.addColorStop(0, "#00ff00"); // green downhill
            //     grad.addColorStop(1, "#aaffaa");
            // } else if (slope < 3) {
            //     grad.addColorStop(0, "#ffffff");
            //     grad.addColorStop(1, "#ffffff");
            // } else {
            //     grad.addColorStop(0, "#ff3300"); // red uphill
            //     grad.addColorStop(1, "#ff9999");
            // }
            // // Draw slope value separately, slightly right of the elevation text
            // ctx.fillStyle = grad;
            // ctx.fillText(`${this.displaySlope.toFixed(1)}%`, markerX + 40, markerY - 12);
            // // ctx.fillText(`${Math.round(currentPoint.ele * 3.28084)} ft, ${slope.toFixed(1)}%`, markerX, markerY - 12);

            // // Optional: text for debug
            // ctx.fillStyle = "#fff";
            // ctx.font = "10px sans-serif";
            // // ctx.fillText(`${slope.toFixed(1)}%`, markerX + 30, markerY + 10);
        }

    }
}
