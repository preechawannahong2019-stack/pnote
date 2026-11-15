package android.print;

import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import java.io.File;

/**
 * Drives a WebView's PrintDocumentAdapter straight into a PDF file (A4) without the system print dialog.
 * Lives in android.print because the layout/write callbacks have package-private constructors.
 */
public class PdfPrint {

    public interface Done { void onDone(File file, Exception error); }

    private final PrintAttributes attributes = new PrintAttributes.Builder()
        .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
        .setResolution(new PrintAttributes.Resolution("pdf", "pdf", 300, 300))
        .setMinMargins(new PrintAttributes.Margins(500, 500, 500, 500)) // mils = 12.7 mm
        .build();

    public void print(PrintDocumentAdapter adapter, File out, Done done) {
        adapter.onLayout(null, attributes, new CancellationSignal(), new PrintDocumentAdapter.LayoutResultCallback() {
            @Override
            public void onLayoutFinished(PrintDocumentInfo info, boolean changed) {
                try {
                    ParcelFileDescriptor fd = ParcelFileDescriptor.open(out, ParcelFileDescriptor.MODE_CREATE | ParcelFileDescriptor.MODE_TRUNCATE | ParcelFileDescriptor.MODE_READ_WRITE);
                    adapter.onWrite(new PageRange[] { PageRange.ALL_PAGES }, fd, new CancellationSignal(), new PrintDocumentAdapter.WriteResultCallback() {
                        @Override
                        public void onWriteFinished(PageRange[] pages) {
                            try { fd.close(); } catch (Exception ignored) {}
                            done.onDone(out, null);
                        }

                        @Override
                        public void onWriteFailed(CharSequence error) {
                            try { fd.close(); } catch (Exception ignored) {}
                            done.onDone(null, new Exception(String.valueOf(error)));
                        }
                    });
                } catch (Exception e) {
                    done.onDone(null, e);
                }
            }

            @Override
            public void onLayoutFailed(CharSequence error) { done.onDone(null, new Exception(String.valueOf(error))); }
        }, null);
    }
}
