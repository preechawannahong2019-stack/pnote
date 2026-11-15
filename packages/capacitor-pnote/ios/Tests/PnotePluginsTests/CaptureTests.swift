import WebKit
import XCTest
@testable import PnotePlugins

final class CaptureTests: XCTestCase {
    func testLimits() {
        XCTAssertEqual(CaptureLimits.clampHeight(100_000), 16_384)
        XCTAssertEqual(CaptureLimits.clampHeight(800), 800)
        XCTAssertNotNil(CaptureLimits.isWebURL(" https://example.go.th/a "))
        XCTAssertNil(CaptureLimits.isWebURL("file:///etc/passwd"))
        XCTAssertNil(CaptureLimits.isWebURL("javascript:alert(1)"))
        XCTAssertNil(CaptureLimits.isWebURL(nil))
    }

    @MainActor
    func testPdfAndScreenshotOfAPage() async throws {
        // a window is needed for WebKit to lay out and paint; the first web process launch on CI simulators is slow
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 400, height: 600))
        let web = WKWebView(frame: window.bounds)
        window.addSubview(web)
        window.isHidden = false
        let loaded = expectation(description: "loaded")
        final class D: NSObject, WKNavigationDelegate { let e: XCTestExpectation; init(_ e: XCTestExpectation) { self.e = e }
            func webView(_ w: WKWebView, didFinish n: WKNavigation!) { e.fulfill() } }
        let delegate = D(loaded)
        web.navigationDelegate = delegate
        web.loadHTMLString("<html><head><meta name='viewport' content='width=device-width'></head><body style='margin:0;height:3000px;background:#ff0000'><h1>หลักฐาน</h1></body></html>", baseURL: nil)
        await fulfillment(of: [loaded], timeout: 120)
        let pdf = CaptureRender.pdf(of: web)
        XCTAssertEqual(String(data: pdf.prefix(5), encoding: .ascii), "%PDF-")
        let png = try await CaptureRender.screenshot(of: web)
        let img = try XCTUnwrap(UIImage(data: png))
        XCTAssertLessThanOrEqual(img.size.height, 16_384)
        XCTAssertGreaterThan(img.size.height, 600)
        // every screen of the page is painted (red), not left blank (white)
        let cg = try XCTUnwrap(img.cgImage)
        let w = cg.width, h = cg.height
        let ctx = try XCTUnwrap(CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                          space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        let px = try XCTUnwrap(ctx.data).assumingMemoryBound(to: UInt8.self)
        print("capture: content \(web.scrollView.contentSize) image \(img.size) px \(w)x\(h)")
        for row in [h / 20, h / 2, h - 10] { // memory rows run top to bottom
            let o = (row * w + w - 20) * 4
            print("capture: row \(row) rgb \(px[o]) \(px[o + 1]) \(px[o + 2])")
            XCTAssertGreaterThan(px[o], 200, "row \(row)")
            XCTAssertLessThan(px[o + 1], 60, "row \(row)")
        }
    }
}
