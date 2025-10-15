// js/overlays/SpeedometerOverlay.js
export class SpeedometerOverlay {
    constructor(parent, opts = {}) {
        this.canvas = document.createElement("canvas");
        this.canvas.classList.add("overlay-canvas", "speedometer");
        this.canvas.width = 3840;
        this.canvas.height = 2160;
        Object.assign(this.canvas.style, {
            width: (opts.width || 200) + "px",
            height: (opts.height || 200) + "px",
            position: "absolute",
            right: opts.right,
            left: opts.left,
            top: opts.top,
            transform: opts.transform,
            background: "rgba(80,80,80,0.35)",
            borderRadius: "12px",
            pointerEvents: "none",
            zIndex: 3
        });
        parent.appendChild(this.canvas);
        this.ctx = this.canvas.getContext("2d");
    }

    update(point) {
        if (!point?.speed) return;
        const mph = point.speed * 2.23694;
        const ctx = this.ctx;
        const w = this.canvas.width, h = this.canvas.height;
        ctx.clearRect(0, 0, w, h);
        ctx.save();
        ctx.scale(4, 4);
        ctx.fillStyle = "white";
        ctx.font = "bold 28px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`${mph.toFixed(1)} mph`, w / 8, h / 8);
        ctx.restore();
    }
}
