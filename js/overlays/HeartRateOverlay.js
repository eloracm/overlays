// js/overlays/HeartRateOverlay.js ❤️
export class HeartRateOverlay {
    constructor(parent, opts = {}) {
        this.canvas = document.createElement("canvas");
        this.canvas.classList.add("overlay-canvas", "heartrate");
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
        if (!point?.hr) return;
        const ctx = this.ctx;
        const w = this.canvas.width, h = this.canvas.height;
        ctx.clearRect(0, 0, w, h);
        ctx.save();
        ctx.scale(4, 4); // adjust for 4K scale factor
        ctx.fillStyle = "white";
        ctx.font = "bold 28px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`${Math.round(point.hr)} bpm`, w / 8, h / 8);
        ctx.restore();
    }
}
