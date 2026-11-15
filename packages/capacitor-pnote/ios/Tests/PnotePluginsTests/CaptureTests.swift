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
        let web = WKWebView(frame: CGRect(x: 0, y: 0, width: 400, height: 600))
        let loaded = expectation(description: "loaded")
        final class D: NSObject, WKNavigationDelegate { let e: XCTestExpectation; init(_ e: XCTestExpectation) { self.e = e }
            func webView(_ w: WKWebView, didFinish n: WKNavigation!) { e.fulfill() } }
        let delegate = D(loaded)
        web.navigationDelegate = delegate
        web.loadHTMLString("<html><body style='height:3000px'><h1>หลักฐาน</h1></body></html>", baseURL: nil)
        await fulfillment(of: [loaded], timeout: 20)
        let pdf = CaptureRender.pdf(of: web)
        XCTAssertEqual(String(data: pdf.prefix(5), encoding: .ascii), "%PDF-")
        let png = try await CaptureRender.screenshot(of: web)
        let img = try XCTUnwrap(UIImage(data: png))
        XCTAssertLessThanOrEqual(img.size.height, 16_384)
        XCTAssertGreaterThan(img.size.height, 600)
    }
}
