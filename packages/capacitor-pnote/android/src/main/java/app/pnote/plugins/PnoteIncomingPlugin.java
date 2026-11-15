package app.pnote.plugins;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.UUID;

/**
 * Files shared to / opened with PNote. Each is copied into <cache>/incoming/<uuid>/<name> and reported to JS as a
 * retained "file" event { name, mime, path } (path relative to the cache directory), so nothing is lost before the
 * web layer listens. The copy is deleted by JS after import or discard.
 */
@CapacitorPlugin(name = "PnoteIncoming")
public class PnoteIncomingPlugin extends Plugin {

    @Override
    public void load() {
        if (getActivity() != null) handle(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        handle(intent);
    }

    private void handle(Intent intent) {
        if (intent == null) return;
        Uri uri = null;
        if (Intent.ACTION_SEND.equals(intent.getAction())) uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        else if (Intent.ACTION_VIEW.equals(intent.getAction())) uri = intent.getData();
        if (uri == null) return;
        intent.setAction(Intent.ACTION_MAIN); // handled once, not again on recreate
        try {
            ContentResolver cr = getContext().getContentResolver();
            String name = displayName(cr, uri);
            File dir = new File(getContext().getCacheDir(), "incoming/" + UUID.randomUUID());
            if (!dir.mkdirs()) return;
            File out = new File(dir, name);
            try (InputStream in = cr.openInputStream(uri); OutputStream os = new FileOutputStream(out)) {
                if (in == null) return;
                byte[] buf = new byte[1 << 16];
                for (int n; (n = in.read(buf)) > 0; ) os.write(buf, 0, n);
            }
            JSObject f = new JSObject();
            f.put("name", name);
            f.put("mime", cr.getType(uri) == null ? "" : cr.getType(uri));
            f.put("path", out.getAbsolutePath().substring(getContext().getCacheDir().getAbsolutePath().length() + 1));
            notifyListeners("file", f, true);
        } catch (Exception ignored) {
            // unreadable source: nothing to import
        }
    }

    /** Safe file name from the provider (no path separators). */
    private static String displayName(ContentResolver cr, Uri uri) {
        String name = null;
        try (Cursor c = cr.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) name = c.getString(0);
        } catch (Exception ignored) {}
        if (name == null || name.isEmpty()) name = uri.getLastPathSegment();
        if (name == null || name.isEmpty()) name = "file";
        return name.replaceAll("[/\\\\:*?\"<>|]", "_");
    }
}
