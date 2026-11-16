package app.pnote.plugins;

import java.io.File;

/**
 * Deletes temporary plaintext files a killed process left in the app cache: exports (export/), shared files never
 * confirmed (incoming/) and captures (capture-*). Runs when the app starts, before a new shared file is copied in.
 * Capture folders younger than {@code captureGraceMs} are kept: a capture may still be running in its own activity.
 */
public final class CacheSweep {
    private CacheSweep() {}

    public static int sweep(File cache, long nowMs, long captureGraceMs) {
        int removed = 0;
        File[] all = cache.listFiles();
        if (all == null) return 0;
        for (File f : all) {
            String n = f.getName();
            boolean stale = n.equals("export") || n.equals("incoming")
                || (n.startsWith("capture-") && nowMs - f.lastModified() > captureGraceMs);
            if (stale && delete(f)) removed++;
        }
        return removed;
    }

    private static boolean delete(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) delete(k);
        return f.delete();
    }
}
