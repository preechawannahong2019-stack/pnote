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

    /// Full-page PNG, capped at 16,384 pt tall, snapshotted in 2,048 pt tiles and stitched.
    @MainActor
    public static func screenshot(of web: WKWebView) async throws -> Data {
        let width = web.scrollView.contentSize.width
        let height = CaptureLimits.clampHeight(web.scrollView.contentSize.height)
        var tiles: [(CGFloat, UIImage)] = []
        var y: CGFloat = 0
        while y < height {
            let h = min(CaptureLimits.tile, height - y)
            let cfg = WKSnapshotConfiguration()
            cfg.rect = CGRect(x: 0, y: y, width: width, height: h)
            cfg.afterScreenUpdates = true
            tiles.append((y, try await web.takeSnapshot(configuration: cfg)))
            y += h
        }
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let image = UIGraphicsImageRenderer(size: CGSize(width: width, height: height), format: format).image { ctx in
            UIColor.white.setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
            for (top, img) in tiles { img.draw(in: CGRect(x: 0, y: top, width: width, height: img.size.height)) }
        }
        guard let png = image.pngData() else { throw NSError(domain: "PnoteCapture", code: 1) }
        return png
    }
}
