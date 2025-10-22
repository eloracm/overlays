// js/overlays/HeartRateOverlay.js ❤️
export class HeartRateOverlay {
    constructor(parent, opts = {}) {
        this.canvas = document.createElement("canvas");
        this.canvas.classList.add("overlay-canvas", "heartrate");
        this.canvas.width = 3840;
        this.canvas.height = 2160;
        Object.assign(this.canvas.style, {
            width: (opts.width || 100) + "px",
            height: (opts.height || 100) + "px",
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
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        ctx.clearRect(0, 0, w, h);

        if (!point?.hr) return;

        ctx.save();
        ctx.scale(4, 4); // 4K scale correction

        // === Draw heart symbol ===
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        ctx.font = "bold 280px 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif";
        ctx.fillStyle = "red";
        ctx.fillText("❤️", w / 8, h / 10);

        // === Draw HR number below ===
        ctx.font = "bold 128px sans-serif";
        ctx.fillStyle = "white";
        ctx.fillText(`${Math.round(point.hr)} bpm`, w / 8, h / 5);

        ctx.restore();
    }
}

