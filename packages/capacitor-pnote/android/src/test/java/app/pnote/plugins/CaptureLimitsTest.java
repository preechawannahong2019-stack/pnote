package app.pnote.plugins;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class CaptureLimitsTest {
    @Test public void capsHeight() {
        assertEquals(16384, CaptureLimits.clampHeight(100_000));
        assertEquals(800, CaptureLimits.clampHeight(800));
        assertEquals(1, CaptureLimits.clampHeight(0));
    }
    @Test public void countsTiles() {
        assertEquals(1, CaptureLimits.tiles(2048));
        assertEquals(2, CaptureLimits.tiles(2049));
        assertEquals(8, CaptureLimits.tiles(16384));
    }
    @Test public void acceptsOnlyWebUrls() {
        assertTrue(CaptureLimits.isWebUrl("https://example.go.th"));
        assertTrue(CaptureLimits.isWebUrl(" http://a.b/c "));
        assertFalse(CaptureLimits.isWebUrl("file:///etc/passwd"));
        assertFalse(CaptureLimits.isWebUrl("javascript:alert(1)"));
        assertFalse(CaptureLimits.isWebUrl(null));
    }
}
