package app.pnote.plugins;

import android.app.Activity;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "PnoteCapture")
public class PnoteCapturePlugin extends Plugin {

    @PluginMethod
    public void capture(PluginCall call) {
        String url = call.getString("url");
        if (!CaptureLimits.isWebUrl(url)) { call.reject("invalid url", "INVALID_URL"); return; }
        Intent i = new Intent(getContext(), CaptureActivity.class);
        i.putExtra(CaptureActivity.EXTRA_URL, url.trim());
        startActivityForResult(call, i, "onCaptureResult");
    }

    @ActivityCallback
    private void onCaptureResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent d = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || d == null) {
            String code = d == null ? "CANCELLED" : d.getStringExtra(CaptureActivity.RESULT_ERROR);
            call.reject("capture did not complete", code == null ? "CANCELLED" : code);
            return;
        }
        JSObject r = new JSObject();
        for (String k : new String[] { "requestedUrl", "finalUrl", "title", "userAgent", "timeZone", "pdfPath", "pngPath", "archivePath" }) r.put(k, d.getStringExtra(k));
        r.put("capturedAt", d.getLongExtra("capturedAt", System.currentTimeMillis()));
        r.put("archiveType", "mht");
        call.resolve(r);
    }
}
