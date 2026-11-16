package app.pnote.plugins;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.Arrays;
import javax.crypto.AEADBadTagException;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class SecureKeyTest {

    private SecureKey key;

    @Before
    public void setUp() throws Exception {
        key = new SecureKey(InstrumentationRegistry.getInstrumentation().getTargetContext());
        key.delete();
    }

    @Test
    public void roundTrips() throws Exception {
        byte[] data = new byte[] { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40 };
        assertArrayEquals(data, key.unwrap(key.wrap(data)));
    }

    @Test
    public void sameInputGivesDifferentCiphertexts() throws Exception {
        byte[] data = "same".getBytes();
        assertFalse(Arrays.equals(key.wrap(data), key.wrap(data)));
    }

    @Test
    public void tamperedDataFails() throws Exception {
        byte[] w = key.wrap("secret".getBytes());
        w[w.length - 1] ^= 1;
        assertThrows(AEADBadTagException.class, () -> key.unwrap(w));
    }

    @Test
    public void deletedKeyIsMissing() throws Exception {
        byte[] w = key.wrap("secret".getBytes());
        key.delete();
        assertThrows(SecureKey.KeyMissing.class, () -> key.unwrap(w));
    }
}
