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
            width: (opts.width || 200) + "px",
            height: (opts.height || 200) + "px",
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
        this._drawSpeedometer(this.displayedSpeed);
    }

    _drawSpeedometer(speed) {
        const ctx = this.ctx;
        const W = this.canvas.width;
        const H = this.canvas.height;

        ctx.clearRect(0, 0, W, H);

        // === scale drawing to match CSS display size ===
        const cssW = parseFloat(this.canvas.style.width);
        const cssH = parseFloat(this.canvas.style.height);
        const scaleX = W / cssW;
        const scaleY = H / cssH;
        ctx.save();
        ctx.scale(scaleX, scaleY);

        const w = cssW;
        const h = cssH;

        const cx = w / 2;
        const cy = h / 2;
        const r = h * 0.35;
        const minAngle = Math.PI;
        const maxAngle = 2 * Math.PI;
        const range = maxAngle - minAngle;

        // background arc
        ctx.beginPath();
        ctx.arc(cx, cy, r, minAngle, maxAngle);
        ctx.strokeStyle = "#444";
        ctx.lineWidth = 6;
        ctx.stroke();

        // ticks + labels
        ctx.lineWidth = 2;
        ctx.font = `${Math.round(r * 0.18)}px sans-serif`;
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";

        for (let mph = 0; mph <= this.maxSpeed; mph += 10) {
            const ratio = mph / this.maxSpeed;
            const a = minAngle + ratio * range;
            const x1 = cx + Math.cos(a) * (r - 4);
            const y1 = cy + Math.sin(a) * (r - 4);
            const x2 = cx + Math.cos(a) * (r - 12);
            const y2 = cy + Math.sin(a) * (r - 12);
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.strokeStyle = "rgba(255,255,255,0.85)";
            ctx.stroke();

            const lx = cx + Math.cos(a) * (r - 26);
            const ly = cy + Math.sin(a) * (r - 26);
            ctx.fillText(mph.toString(), lx, ly);
        }

        // clamp + draw needle
        const cur = Math.min(Math.max(speed, 0), this.maxSpeed);
        const needleAngle = minAngle + (cur / this.maxSpeed) * range;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(needleAngle) * (r - 18),
            cy + Math.sin(needleAngle) * (r - 18));
        ctx.strokeStyle = "red";
        ctx.lineWidth = 3;
        ctx.stroke();

        // center hub
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fillStyle = "red";
        ctx.fill();

        // text
        ctx.font = `bold ${Math.round(r * 0.3)}px sans-serif`;
        ctx.fillStyle = "white";
        ctx.textAlign = "center";
        ctx.fillText(`${cur.toFixed(1)} mph`, cx, cy + r * 0.6);

        ctx.restore();
    }
}
