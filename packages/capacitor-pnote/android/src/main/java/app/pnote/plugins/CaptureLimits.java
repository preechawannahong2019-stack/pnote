package app.pnote.plugins;

/** Pure helpers for the capture screenshot, unit-tested on the JVM. */
public final class CaptureLimits {
    public static final int MAX_HEIGHT_PX = 16384;
    public static final int TILE_PX = 2048;
    public static final long LOAD_TIMEOUT_MS = 60_000;
    /** Screenshot bitmap size cap: 16 M pixels, about 32 MB as RGB_565. */
    public static final long MAX_PIXELS = 16_000_000L;

    private CaptureLimits() {}

    public static int clampHeight(int contentHeightPx) { return Math.max(1, Math.min(contentHeightPx, MAX_HEIGHT_PX)); }

    /** Factor (≤ 1) applied to both sides of a width × height screenshot so it stays within MAX_PIXELS. */
    public static double outputScale(int width, int height) {
        double px = (double) width * height;
        return px <= MAX_PIXELS ? 1.0 : Math.sqrt(MAX_PIXELS / px);
    }

    /** Number of tiles needed to draw `height` pixels. */
    public static int tiles(int height) { return (height + TILE_PX - 1) / TILE_PX; }

    public static boolean isWebUrl(String url) {
        if (url == null) return false;
        String u = url.trim().toLowerCase();
        return (u.startsWith("https://") || u.startsWith("http://")) && u.length() > 8;
    }
}
