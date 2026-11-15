package app.pnote.plugins;

import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import javax.crypto.AEADBadTagException;

@CapacitorPlugin(name = "PnoteSecure")
public class PnoteSecurePlugin extends Plugin {

    private SecureKey key;

    @Override
    public void load() { key = new SecureKey(getContext()); }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("available", true);
        r.put("hardware", key.hardware());
        call.resolve(r);
    }

    @PluginMethod
    public void wrap(PluginCall call) {
        try {
            byte[] in = Base64.decode(call.getString("data", ""), Base64.NO_WRAP);
            JSObject r = new JSObject();
            r.put("data", Base64.encodeToString(key.wrap(in), Base64.NO_WRAP));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("wrap failed", "WRAP_FAILED", e);
        }
    }

    @PluginMethod
    public void unwrap(PluginCall call) {
        try {
            byte[] in = Base64.decode(call.getString("data", ""), Base64.NO_WRAP);
            JSObject r = new JSObject();
            r.put("data", Base64.encodeToString(key.unwrap(in), Base64.NO_WRAP));
            call.resolve(r);
        } catch (SecureKey.KeyMissing e) {
            call.reject("device key is missing", "KEY_MISSING", e);
        } catch (KeyPermanentlyInvalidatedException e) {
            call.reject("device key was invalidated", "KEY_INVALID", e);
        } catch (AEADBadTagException e) {
            call.reject("data could not be decrypted", "DECRYPT_FAILED", e);
        } catch (Exception e) {
            call.reject("unwrap failed", "DECRYPT_FAILED", e);
        }
    }

    @PluginMethod
    public void excludeFromBackup(PluginCall call) {
        call.resolve(); // app data is excluded from backups in the app manifest (allowBackup=false, dataExtractionRules)
    }
}
