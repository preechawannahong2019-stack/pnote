package app.pnote.plugins;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.file.Files;
import org.junit.Test;

public class CacheSweepTest {
    private static File file(File dir, String rel) throws Exception {
        File f = new File(dir, rel);
        f.getParentFile().mkdirs();
        try (FileOutputStream o = new FileOutputStream(f)) { o.write(1); }
        return f;
    }

    @Test
    public void removesLeftoverExportsIncomingAndOldCapturesOnly() throws Exception {
        File cache = Files.createTempDirectory("cache").toFile();
        file(cache, "export/123/case.pdf");
        file(cache, "incoming/u1/a.pnote");
        File old = file(cache, "capture-old/screenshot.png").getParentFile();
        old.setLastModified(1_000);
        File fresh = file(cache, "capture-new/page.pdf").getParentFile();
        fresh.setLastModified(10_000_000);
        File other = file(cache, "WebView/x");

        assertEquals(3, CacheSweep.sweep(cache, 10_000_000 + 60_000, 3_600_000));
        assertFalse(new File(cache, "export").exists());
        assertFalse(new File(cache, "incoming").exists());
        assertFalse(old.exists());
        assertTrue(fresh.exists());
        assertTrue(other.exists());
    }
}
