package app.pnote.plugins;

/** Pure helpers for the capture screenshot, unit-tested on the JVM. */
public final class CaptureLimits {
    public static final int MAX_HEIGHT_PX = 16384;
    public static final int TILE_PX = 2048;
    public static final long LOAD_TIMEOUT_MS = 60_000;

    private CaptureLimits() {}

    public static int clampHeight(int contentHeightPx) { return Math.max(1, Math.min(contentHeightPx, MAX_HEIGHT_PX)); }

    /** Number of tiles needed to draw `height` pixels. */
    public static int tiles(int height) { return (height + TILE_PX - 1) / TILE_PX; }

    public static boolean isWebUrl(String url) {
        if (url == null) return false;
        String u = url.trim().toLowerCase();
        return (u.startsWith("https://") || u.startsWith("http://")) && u.length() > 8;
    }
}
