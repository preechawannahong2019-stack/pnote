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
        web.loadHTMLString("<html><body style='margin:0;height:3000px;position:relative'><h1>หลักฐาน</h1><div style='position:absolute;left:0;right:0;bottom:0;height:200px;background:#ff0000'></div></body></html>", baseURL: nil)
        await fulfillment(of: [loaded], timeout: 120)
        let pdf = CaptureRender.pdf(of: web)
        XCTAssertEqual(String(data: pdf.prefix(5), encoding: .ascii), "%PDF-")
        let png = try await CaptureRender.screenshot(of: web)
        let img = try XCTUnwrap(UIImage(data: png))
        XCTAssertLessThanOrEqual(img.size.height, 16_384)
        XCTAssertGreaterThan(img.size.height, 600)
        // content below the first screen is painted, not blank
        let cg = try XCTUnwrap(img.cgImage)
        let ctx = try XCTUnwrap(CGContext(data: nil, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                                          space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        ctx.draw(cg, in: CGRect(x: -CGFloat(cg.width) / 2, y: -10, width: CGFloat(cg.width), height: CGFloat(cg.height))) // pixel 10 px above the bottom
        let px = try XCTUnwrap(ctx.data).assumingMemoryBound(to: UInt8.self)
        XCTAssertGreaterThan(px[0], 200)
        XCTAssertLessThan(px[1], 60)
    }
}
