// js/utils/TimeUtils.js

/**
 * Converts an ISO or UTC string to a local Date object.
 * Does NOT double-apply time zones.
 */
export function toLocalDate(isoString) {
    // If timestamp already has 'Z', treat as UTC and convert to local Date
    return new Date(isoString);
}

/**
 * Format a Date object as HH:MM:SS (local time).
 */
export function formatTime(date) {
    if (!(date instanceof Date)) date = new Date(date);
    return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });
}

/**
 * Compute offset between GPX start and video creation time.
 * Useful for syncing telemetry to video.
 */
export function computeTimeOffset(videoStartMs, gpxStartMs) {
    return gpxStartMs - videoStartMs;
}
