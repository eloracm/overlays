// js/overlays/SpeedometerOverlay.js
export class SpeedometerOverlay {
    constructor(parent, opts = {}) {
        this.maxSpeed = opts.maxMph || 40;
        this.smoothFactor = 0.1;
        this.displayedSpeed = 0;

        this.canvas = document.createElement("canvas");
        this.canvas.classList.add("overlay-canvas", "speedometer");
        this.canvas.width = 3840;
        this.canvas.height = 2160;

        Object.assign(this.canvas.style, {
            width: (opts.width || 240) + "px",
            height: (opts.height || 150) + "px",
            position: "absolute",
            left: "50%",
            top: "20px",
            transform: "translateX(-50%)",
            background: "rgba(80,80,80,0.35)",
            borderRadius: "12px",
            pointerEvents: "none",
            zIndex: 3
        });

        parent.appendChild(this.canvas);
        this.ctx = this.canvas.getContext("2d");
    }

    update(point) {
        if (!point) return;
        const mph = typeof point.speedMph === "number" ? point.speedMph : 0;
        this.displayedSpeed += (mph - this.displayedSpeed) * this.smoothFactor;
        this._drawArcGauge(this.displayedSpeed);
    }

    _drawArcGauge(speed) {
        const ctx = this.ctx;
        const W = this.canvas.width, H = this.canvas.height;
        ctx.clearRect(0, 0, W, H);

        const cssW = parseFloat(this.canvas.style.width);
        const cssH = parseFloat(this.canvas.style.height);
        const scale = W / cssW;
        ctx.save();
        ctx.scale(scale, scale);

        const w = cssW, h = cssH;
        const cx = w / 2;
        const cy = h * (2 / 3);          // about one-third up from bottom
        const r = w * 0.375;             // 75% of width ⇒ radius = 0.75 w / 2
        const minAngle = Math.PI;
        const maxAngle = 2 * Math.PI;
        const range = maxAngle - minAngle;

        // Background arc
        ctx.beginPath();
        ctx.arc(cx, cy, r, minAngle, maxAngle);
        ctx.strokeStyle = "#444";
        ctx.lineWidth = 14;
        ctx.lineCap = "round";
        ctx.stroke();

        // Foreground (speed) arc
        const cur = Math.min(Math.max(speed, 0), this.maxSpeed);
        const endAngle = minAngle + (cur / this.maxSpeed) * range;
        const grad = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
        grad.addColorStop(0.0, "#00b4ff");
        grad.addColorStop(0.45, "#00ff88");
        grad.addColorStop(0.8, "#ffd24d");
        grad.addColorStop(1.0, "#ff6b6b");

        ctx.beginPath();
        ctx.arc(cx, cy, r, minAngle, endAngle);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 14;
        ctx.lineCap = "round";
        ctx.stroke();

        // Tick marks & labels
        ctx.lineWidth = 2;
        ctx.font = `${Math.round(r * 0.18)}px sans-serif`;
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        for (let mph = 0; mph <= this.maxSpeed; mph += 5) {
            const ratio = mph / this.maxSpeed;
            const a = minAngle + ratio * range;
            const x1 = cx + Math.cos(a) * (r + 2);
            const y1 = cy + Math.sin(a) * (r + 2);
            const x2 = cx + Math.cos(a) * (r - 10);
            const y2 = cy + Math.sin(a) * (r - 10);
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.strokeStyle = "rgba(255,255,255,0.6)";
            ctx.stroke();

            // label every tick
            const lx = cx + Math.cos(a) * (r - 24);
            const ly = cy + Math.sin(a) * (r - 24);
            ctx.fillText(mph.toString(), lx, ly);
        }

        // Speed text — moved upward into the arc
        const textY = cy - r * 0.25;
        ctx.font = `bold ${Math.round(r * 0.35)}px sans-serif`;
        ctx.fillStyle = "white";
        ctx.fillText(`${cur.toFixed(1)}`, cx, textY);
        ctx.font = `bold ${Math.round(r * 0.22)}px sans-serif`;
        ctx.fillText("mph", cx, textY + r * 0.30);

        ctx.restore();
    }
}
