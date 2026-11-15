import Capacitor
import Foundation

@objc(PnoteCapturePlugin)
public class PnoteCapturePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PnoteCapturePlugin"
    public let jsName = "PnoteCapture"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "capture", returnType: CAPPluginReturnPromise)]

    @objc func capture(_ call: CAPPluginCall) {
        guard let url = CaptureLimits.isWebURL(call.getString("url")) else { return call.reject("invalid url", "INVALID_URL") }
        DispatchQueue.main.async {
            let vc = CaptureViewController(url: url) { result in
                switch result {
                case .success(let r):
                    // paths relative to Library/Caches, which is Capacitor's Directory.Cache
                    let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].path + "/"
                    let rel = { (name: String) in r.dir.appendingPathComponent(name).path.replacingOccurrences(of: base, with: "") }
                    call.resolve([
                        "requestedUrl": r.requestedUrl, "finalUrl": r.finalUrl, "title": r.title, "userAgent": r.userAgent,
                        "capturedAt": r.capturedAt, "timeZone": r.timeZone,
                        "pdfPath": rel("page.pdf"), "pngPath": rel("screenshot.png"), "archivePath": rel("page.webarchive"), "archiveType": "webarchive",
                    ])
                case .failure(.cancelled): call.reject("cancelled", "CANCELLED")
                case .failure(.timeout): call.reject("timeout", "TIMEOUT")
                case .failure(.loadFailed): call.reject("load failed", "LOAD_FAILED")
                }
            }
            self.bridge?.viewController?.present(vc, animated: true)
        }
    }
}
