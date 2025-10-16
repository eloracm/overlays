export class ElevationOverlay {
    constructor(canvasId, gpxManager) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext("2d");
        this.gpx = gpxManager;

        // Internal 4K resolution, scaled display
        this.canvas.width = 3840;
        this.canvas.height = 2160;
        this.canvas.style.width = "1200px";
        this.canvas.style.height = "180px";

        // Scale context for drawing in visible coordinates
        const scaleX = this.canvas.width / parseInt(this.canvas.style.width);
        const scaleY = this.canvas.height / parseInt(this.canvas.style.height);
        this.ctx.scale(scaleX, scaleY);
    }

    update(currentPoint, currentTargetTimeMs) {
        const ctx = this.ctx;
        const visibleW = parseInt(this.canvas.style.width);
        const visibleH = parseInt(this.canvas.style.height);
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
            let color = "#ffff66";
            if (slope < -3) color = "#00ff88";
            else if (slope < 1) color = "#ffff66";
            else if (slope < 5) color = "#ff9933";
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
        ctx.moveTo(gxL, gxB);
        ctx.lineTo(gxR, gxB);
        ctx.lineTo(gxR, gxT);
        ctx.stroke();

        ctx.fillStyle = "#fff";
        ctx.font = "10px sans-serif";
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

        // === current marker ===
        if (currentPoint) {
            const markerX = gxL + (currentPoint.miles / totalMilesSafe) * (gxR - gxL);
            const markerY = gxB - ((currentPoint.ele * 3.28084 - minEleFt) / eleRange) * graphH;
            ctx.beginPath();
            ctx.arc(markerX, markerY, 5, 0, Math.PI * 2);
            ctx.fillStyle = "red";
            ctx.fill();
            ctx.font = "bold 12px sans-serif";
            ctx.textAlign = "center";
            ctx.fillStyle = "white";
            ctx.fillText(`${Math.round(currentPoint.ele * 3.28084)} ft`, markerX, markerY - 8);
        }
    }
}
