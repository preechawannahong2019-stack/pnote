import UIKit
import WebKit

public enum CaptureLimits {
    public static let maxHeight: CGFloat = 16_384
    public static let tile: CGFloat = 2_048
    public static let loadTimeout: TimeInterval = 60
    public static let a4 = CGRect(x: 0, y: 0, width: 595.28, height: 841.89)

    public static func clampHeight(_ h: CGFloat) -> CGFloat { max(1, min(h, maxHeight)) }

    public static func isWebURL(_ s: String?) -> URL? {
        guard let s = s?.trimmingCharacters(in: .whitespaces), let u = URL(string: s), let scheme = u.scheme?.lowercased(),
              scheme == "https" || scheme == "http", u.host != nil else { return nil }
        return u
    }
}

public enum CaptureRender {
    /// Paginated A4 PDF of the page, through the web view's print formatter (12.7 mm margins).
    @MainActor
    public static func pdf(of web: WKWebView) -> Data {
        let renderer = UIPrintPageRenderer()
        renderer.addPrintFormatter(web.viewPrintFormatter(), startingAtPageAt: 0)
        let margin: CGFloat = 36
        renderer.setValue(NSValue(cgRect: CaptureLimits.a4), forKey: "paperRect")
        renderer.setValue(NSValue(cgRect: CaptureLimits.a4.insetBy(dx: margin, dy: margin)), forKey: "printableRect")
        let data = NSMutableData()
        UIGraphicsBeginPDFContextToData(data, CaptureLimits.a4, nil)
        renderer.prepare(forDrawingPages: NSRange(location: 0, length: renderer.numberOfPages))
        for i in 0..<max(1, renderer.numberOfPages) {
            UIGraphicsBeginPDFPage()
            renderer.drawPage(at: i, in: UIGraphicsGetPDFContextBounds())
        }
        UIGraphicsEndPDFContext()
        return data as Data
    }

    /// Full-page PNG, capped at 16,384 pt tall. WebKit paints only what is on screen, so the page is scrolled one
    /// viewport at a time, each viewport snapshotted, and the pieces stitched (fixed headers repeat in each piece).
    @MainActor
    public static func screenshot(of web: WKWebView) async throws -> Data {
        let width = web.bounds.width
        let viewport = max(1, web.bounds.height)
        let height = CaptureLimits.clampHeight(web.scrollView.contentSize.height)
        let scroll = web.scrollView
        let savedOffset = scroll.contentOffset
        let savedInsets = scroll.contentInsetAdjustmentBehavior
        scroll.contentInsetAdjustmentBehavior = .never
        defer { scroll.contentInsetAdjustmentBehavior = savedInsets; scroll.contentOffset = savedOffset }
        // each piece is drawn into one scale-1 bitmap as soon as it arrives, so at most one viewport is held besides it
        guard let ctx = CGContext(data: nil, width: Int(width.rounded(.up)), height: Int(height.rounded(.up)), bitsPerComponent: 8,
                                  bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
        else { throw NSError(domain: "PnoteCapture", code: 2) }
        ctx.setFillColor(UIColor.white.cgColor)
        ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
        var y: CGFloat = 0
        while y < height {
            let h = min(viewport, height - y)
            scroll.setContentOffset(CGPoint(x: 0, y: min(y, max(0, scroll.contentSize.height - viewport))), animated: false)
            let shown = scroll.contentOffset.y // the last piece may sit higher than y when the page ends
            let cfg = WKSnapshotConfiguration()
            cfg.rect = CGRect(x: 0, y: y - shown, width: width, height: h) // view coordinates
            cfg.snapshotWidth = NSNumber(value: Double(width)) // scale 1, not the screen's 2-3x
            cfg.afterScreenUpdates = true
            let piece = try await web.takeSnapshot(configuration: cfg)
            if let cg = piece.cgImage { ctx.draw(cg, in: CGRect(x: 0, y: height - y - h, width: width, height: h)) } // CG origin is bottom-left
            y += h
        }
        guard let stitched = ctx.makeImage() else { throw NSError(domain: "PnoteCapture", code: 3) }
        let image = UIImage(cgImage: stitched)
        guard let png = image.pngData() else { throw NSError(domain: "PnoteCapture", code: 1) }
        return png
    }
}
