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

        // // === current marker ===
        // if (currentPoint) {
        //     const markerX = gxL + (currentPoint.miles / totalMilesSafe) * (gxR - gxL);
        //     const markerY = gxB - ((currentPoint.ele * 3.28084 - minEleFt) / eleRange) * graphH;
        //     ctx.beginPath();
        //     ctx.arc(markerX, markerY, 5, 0, Math.PI * 2);
        //     ctx.fillStyle = "red";
        //     ctx.fill();
        //     // === current marker and slope ===
        //     ctx.beginPath();
        //     ctx.arc(markerX, markerY, 5, 0, Math.PI * 2);
        //     ctx.fillStyle = "red";
        //     ctx.fill();

        //     // --- compute slope over recent 10m (~30ft) segment ---
        //     let slopePct = 0;
        //     if (points.length > 2) {
        //         const idx = points.indexOf(currentPoint);
        //         if (idx > 1) {
        //             // look ~5 points back for smoother slope
        //             const prev = points[Math.max(0, idx - 5)];
        //             const dxM = (currentPoint.cumMiles - prev.cumMiles) * 1609.34;
        //             const dyM = (currentPoint.ele - prev.ele);
        //             slopePct = dxM > 0 ? (dyM / dxM) * 100 : 0;
        //         }
        //     }

        //     const slopeStr = slopePct.toFixed(1);
        //     const elevStr = `${Math.round(currentPoint.ele * 3.28084)} ft`;
        //     const label = `${elevStr}  (${slopeStr}% grade)`;

        //     ctx.font = "bold 13px sans-serif";
        //     ctx.textAlign = "center";
        //     ctx.fillStyle = "white";
        //     ctx.fillText(label, markerX, markerY - 10);

        // }
        // === current marker with slope visuals ===
        if (currentPoint) {
            const markerX = gxL + (currentPoint.miles / totalMilesSafe) * (gxR - gxL);
            const markerY = gxB - ((currentPoint.ele * 3.28084 - minEleFt) / eleRange) * graphH;

            // Compute slope %
            const idx = this.gpx.points.indexOf(currentPoint);
            let slope = 0;
            if (idx > 0) {
                const prev = this.gpx.points[idx - 1];
                const distM = (currentPoint.cumMiles - prev.cumMiles) * 1609.34;
                const elevDelta = currentPoint.ele - prev.ele;
                slope = distM > 0 ? (elevDelta / distM) * 100 : 0;
            }

            // --- Marker circle ---
            ctx.beginPath();
            ctx.arc(markerX, markerY, 5, 0, Math.PI * 2);
            ctx.fillStyle = "red";
            ctx.fill();

            // --- Elevation label ---
            ctx.font = "bold 12px sans-serif";
            ctx.textAlign = "center";
            ctx.fillStyle = "white";
            ctx.fillText(`${Math.round(currentPoint.ele * 3.28084)} ft`, markerX, markerY - 12);

            // ========== OPTION 1: Tilted Arrow Indicator ==========
            const len = 18;
            const angle = (-slope / 20) * Math.PI / 4; // ±20% slope → ±45° tilt
            ctx.save();
            ctx.translate(markerX + 28, markerY - 6);
            ctx.rotate(angle);
            ctx.beginPath();
            ctx.moveTo(-len / 2, 0);
            ctx.lineTo(len / 2, 0);
            ctx.lineTo(len / 2 - 5, -5);
            ctx.moveTo(len / 2, 0);
            ctx.lineTo(len / 2 - 5, 5);
            ctx.strokeStyle = slope >= 0 ? "#ff6633" : "#33cc33";
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.restore();

            // ========== OPTION 2: Horizontal Bar Indicator ==========
            const barW = 20, barH = 4;
            const maxSlope = 15; // limit for full scale
            const normalized = Math.max(-1, Math.min(1, slope / maxSlope));
            const barX = markerX + 60;
            const barY = markerY - 4;

            ctx.fillStyle = "rgba(255,255,255,0.2)";
            ctx.fillRect(barX - barW / 2, barY, barW, barH);
            ctx.fillStyle = slope >= 0 ? "#ff6633" : "#33cc33";

            if (normalized >= 0) {
                ctx.fillRect(barX, barY, barW * normalized / 2, barH);
            } else {
                ctx.fillRect(barX + barW * normalized / 2, barY, barW * (-normalized / 2), barH);
            }

            // Optional: text for debug
            // ctx.fillStyle = "#fff";
            // ctx.font = "10px sans-serif";
            // ctx.fillText(`${slope.toFixed(1)}%`, barX + 30, barY + 10);
        }

    }
}
