package app.pnote.plugins;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.print.PdfPrint;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileInputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class PdfPrintTest {
    @Test
    public void printsAWebViewToAPdfFile() throws Exception {
        Context ctx = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File out = new File(ctx.getCacheDir(), "print-test.pdf");
        CountDownLatch done = new CountDownLatch(1);
        final Exception[] err = { null };
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            WebView w = new WebView(ctx);
            w.setWebViewClient(new WebViewClient() {
                @Override public void onPageFinished(WebView view, String url) {
                    new PdfPrint().print(view.createPrintDocumentAdapter("t"), out, (f, e) -> { err[0] = e; done.countDown(); });
                }
            });
            w.loadData("<html><body><h1>หลักฐาน</h1><p>evidence</p></body></html>", "text/html; charset=utf-8", "utf-8");
        });
        assertTrue(done.await(30, TimeUnit.SECONDS));
        assertNull(err[0]);
        byte[] head = new byte[5];
        try (FileInputStream in = new FileInputStream(out)) { assertEquals(5, in.read(head)); }
        assertEquals("%PDF-", new String(head, "US-ASCII"));
    }
}
