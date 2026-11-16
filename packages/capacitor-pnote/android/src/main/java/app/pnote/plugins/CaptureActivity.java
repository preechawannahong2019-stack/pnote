package app.pnote.plugins;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.print.PdfPrint;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.File;
import java.io.FileOutputStream;
import java.util.TimeZone;
import java.util.UUID;

/**
 * Full-screen browser for one capture. The user may log in; "บันทึกหน้านี้" saves PDF (A4), full-page PNG and MHTML
 * into the cache directory and returns their paths. Cookies and the site's storage are cleared when it closes.
 */
public class CaptureActivity extends Activity {

    public static final String EXTRA_URL = "url";
    public static final String RESULT_ERROR = "error";

    private WebView web;
    private TextView urlView;
    private Button save;
    private final Handler main = new Handler(Looper.getMainLooper());
    private boolean loaded = false;
    private String requestedUrl;
    private File dir;
    private boolean cleaned = false;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
        WebView.enableSlowWholeDocumentDraw(); // must precede WebView creation: lets draw() render the whole page
        requestedUrl = getIntent().getStringExtra(EXTRA_URL);
        dir = new File(getCacheDir(), "capture-" + UUID.randomUUID());

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(16, 8, 16, 8);
        bar.setBackgroundColor(Color.WHITE);
        Button cancel = new Button(this);
        cancel.setText("ยกเลิก");
        cancel.setOnClickListener(v -> finishWith("CANCELLED"));
        urlView = new TextView(this);
        urlView.setSingleLine(true);
        urlView.setPadding(16, 0, 16, 0);
        save = new Button(this);
        save.setText("บันทึกหน้านี้");
        save.setEnabled(false);
        save.setOnClickListener(v -> capture());
        bar.addView(cancel);
        bar.addView(urlView, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        bar.addView(save);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true); // most pages need it; the page cannot reach the app (no JS bridge here)
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                loaded = true;
                urlView.setText(url);
                save.setEnabled(true);
            }
        });
        root.addView(bar);
        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);

        main.postDelayed(() -> { if (!loaded) finishWith("TIMEOUT"); }, CaptureLimits.LOAD_TIMEOUT_MS);
        cleanUp(requestedUrl); // also before loading: a session left by a capture whose process was killed is not reused
        web.loadUrl(requestedUrl);
    }

    private void capture() {
        save.setEnabled(false);
        if (!dir.mkdirs() && !dir.isDirectory()) { finishWith("LOAD_FAILED"); return; }
        final String finalUrl = web.getUrl();
        final String title = web.getTitle();
        final File png = new File(dir, "screenshot.png");
        final File mht = new File(dir, "page.mht");
        final File pdf = new File(dir, "page.pdf");
        try {
            writeScreenshot(png);
        } catch (Throwable e) { // includes OutOfMemoryError
            finishWith("LOAD_FAILED");
            return;
        }
        web.saveWebArchive(mht.getAbsolutePath(), false, archivePath -> {
            if (archivePath == null) { finishWith("LOAD_FAILED"); return; }
            new PdfPrint().print(web.createPrintDocumentAdapter("page"), pdf, (file, error) -> main.post(() -> {
                if (error != null) { finishWith("LOAD_FAILED"); return; }
                Intent r = new Intent();
                r.putExtra("requestedUrl", requestedUrl);
                r.putExtra("finalUrl", finalUrl == null ? requestedUrl : finalUrl);
                r.putExtra("title", title == null ? "" : title);
                r.putExtra("userAgent", web.getSettings().getUserAgentString());
                r.putExtra("capturedAt", System.currentTimeMillis());
                r.putExtra("timeZone", TimeZone.getDefault().getID());
                String base = getCacheDir().getAbsolutePath() + "/";
                r.putExtra("pdfPath", pdf.getAbsolutePath().substring(base.length()));
                r.putExtra("pngPath", png.getAbsolutePath().substring(base.length()));
                r.putExtra("archivePath", mht.getAbsolutePath().substring(base.length()));
                setResult(RESULT_OK, r);
                cleanUp(finalUrl);
                cleaned = true;
                finish();
            }));
        });
    }

    /**
     * Whole page (enableSlowWholeDocumentDraw), capped at 16,384 px tall and scaled down to at most
     * CaptureLimits.MAX_PIXELS as RGB_565, so the one bitmap PNG encoding needs stays around 32 MB at most.
     */
    private void writeScreenshot(File out) throws Exception {
        int width = web.getWidth();
        int contentHeight = (int) Math.ceil(web.getContentHeight() * getResources().getDisplayMetrics().density);
        int height = CaptureLimits.clampHeight(contentHeight);
        double scale = CaptureLimits.outputScale(width, height);
        Bitmap bmp = Bitmap.createBitmap((int) Math.ceil(width * scale), (int) Math.ceil(height * scale), Bitmap.Config.RGB_565);
        Canvas canvas = new Canvas(bmp);
        canvas.drawColor(Color.WHITE);
        canvas.scale((float) scale, (float) scale);
        canvas.translate(-web.getScrollX(), -web.getScrollY()); // draw() paints relative to the current scroll position
        web.draw(canvas);
        try (FileOutputStream fos = new FileOutputStream(out)) { bmp.compress(Bitmap.CompressFormat.PNG, 100, fos); }
        bmp.recycle();
    }

    private void cleanUp(String url) {
        CookieManager.getInstance().removeAllCookies(null);
        CookieManager.getInstance().flush();
        try {
            Uri u = Uri.parse(url == null ? requestedUrl : url);
            WebStorage.getInstance().deleteOrigin(u.getScheme() + "://" + u.getAuthority());
        } catch (Exception ignored) {}
        web.clearCache(true);
        web.clearHistory();
    }

    private void finishWith(String code) {
        if (isFinishing()) return;
        Intent r = new Intent();
        r.putExtra(RESULT_ERROR, code);
        setResult(RESULT_CANCELED, r);
        cleanUp(web == null ? requestedUrl : web.getUrl());
        cleaned = true;
        deleteRecursive(dir);
        finish();
    }

    private static void deleteRecursive(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteRecursive(k);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    @Override
    public void onBackPressed() { finishWith("CANCELLED"); }

    @Override
    protected void onDestroy() {
        main.removeCallbacksAndMessages(null);
        if (web != null && !cleaned) { cleanUp(web.getUrl()); deleteRecursive(dir); } // closed by the system
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
