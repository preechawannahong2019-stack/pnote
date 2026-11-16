package app.pnote.plugins;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.security.KeyStore;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * A non-exportable AES-256-GCM key in the Android Keystore (StrongBox when the device has one, else the TEE).
 * Output of wrap(): iv (12 bytes) || ciphertext || tag (16 bytes).
 */
public class SecureKey {

    public static final String ALIAS = "pnote-device-key-v1";
    private static final String PREFS = "pnote-secure";
    private static final int IV_LEN = 12;

    /** The key does not exist (never created, or wiped with the app data / keystore). */
    public static class KeyMissing extends Exception {
        public KeyMissing() { super("device key is missing"); }
    }

    private final Context context;

    public SecureKey(Context context) { this.context = context.getApplicationContext(); }

    private KeyStore keyStore() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        return ks;
    }

    private SecretKey existing() throws Exception {
        KeyStore ks = keyStore();
        if (!ks.containsAlias(ALIAS)) return null;
        KeyStore.Entry e = ks.getEntry(ALIAS, null);
        return e instanceof KeyStore.SecretKeyEntry ? ((KeyStore.SecretKeyEntry) e).getSecretKey() : null;
    }

    private SecretKey create() throws Exception {
        boolean strongbox = Build.VERSION.SDK_INT >= 28 &&
            context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE);
        try {
            return generate(strongbox);
        } catch (Exception e) {
            if (!strongbox) throw e;
            return generate(false); // StrongBoxUnavailableException or a vendor quirk: fall back to the TEE
        }
    }

    private SecretKey generate(boolean strongbox) throws Exception {
        KeyGenParameterSpec.Builder b = new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setRandomizedEncryptionRequired(true);
        if (strongbox && Build.VERSION.SDK_INT >= 28) b.setIsStrongBoxBacked(true);
        KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        g.init(b.build());
        SecretKey k = g.generateKey();
        prefs().edit().putString("hardware", strongbox ? "strongbox" : "tee").apply();
        return k;
    }

    private SharedPreferences prefs() { return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    public String hardware() { return prefs().getString("hardware", "tee"); }

    /** Encrypts with the device key, creating it on first use. */
    public byte[] wrap(byte[] plain) throws Exception {
        SecretKey k = existing();
        if (k == null) k = create();
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, k);
        byte[] iv = c.getIV();
        byte[] ct = c.doFinal(plain);
        byte[] out = Arrays.copyOf(iv, iv.length + ct.length);
        System.arraycopy(ct, 0, out, iv.length, ct.length);
        return out;
    }

    /**
     * Decrypts with the device key. Throws KeyMissing when there is no key,
     * KeyPermanentlyInvalidatedException when the keystore invalidated it, AEADBadTagException when data was altered.
     */
    public byte[] unwrap(byte[] data) throws Exception {
        SecretKey k = existing();
        if (k == null) throw new KeyMissing();
        if (data.length < IV_LEN + 16) throw new javax.crypto.AEADBadTagException("too short");
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, k, new GCMParameterSpec(128, data, 0, IV_LEN));
        return c.doFinal(data, IV_LEN, data.length - IV_LEN);
    }

    /** For tests and for "forget this device". */
    public void delete() throws Exception {
        keyStore().deleteEntry(ALIAS);
    }
}
