// js/utils/HiDPIUtils.js
export function setupHiDPI(canvas, baseWidth = 1280, baseHeight = 720, internalScale = 3) {
    const ctx = canvas.getContext("2d");
    canvas.width = baseWidth * internalScale;
    canvas.height = baseHeight * internalScale;
    canvas.style.width = `${baseWidth}px`;
    canvas.style.height = `${baseHeight}px`;
    ctx.scale(internalScale, internalScale);
    return ctx;
}
