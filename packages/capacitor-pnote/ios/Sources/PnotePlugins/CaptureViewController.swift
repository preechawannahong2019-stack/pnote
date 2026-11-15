import UIKit
import WebKit

/// One capture: a private (non-persistent) browser the user can log in to; "บันทึกหน้านี้" saves PDF, PNG and .webarchive.
final class CaptureViewController: UIViewController, WKNavigationDelegate {
    struct Result { let requestedUrl: String; let finalUrl: String; let title: String; let userAgent: String; let capturedAt: Double; let timeZone: String; let dir: URL }

    private let url: URL
    private let completion: (Swift.Result<Result, CaptureError>) -> Void
    private var web: WKWebView!
    private var saveButton: UIBarButtonItem!
    private var loaded = false
    private var finished = false
    private var timeout: Timer?

    enum CaptureError: Error { case cancelled, timeout, loadFailed }

    init(url: URL, completion: @escaping (Swift.Result<Result, CaptureError>) -> Void) {
        self.url = url
        self.completion = completion
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent() // nothing (cookies, storage) survives the capture
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.translatesAutoresizingMaskIntoConstraints = false
        let bar = UIToolbar()
        bar.translatesAutoresizingMaskIntoConstraints = false
        saveButton = UIBarButtonItem(title: "บันทึกหน้านี้", style: .done, target: self, action: #selector(save))
        saveButton.isEnabled = false
        bar.items = [UIBarButtonItem(title: "ยกเลิก", style: .plain, target: self, action: #selector(cancel)), UIBarButtonItem(systemItem: .flexibleSpace), saveButton]
        view.backgroundColor = .systemBackground
        view.addSubview(bar)
        view.addSubview(web)
        NSLayoutConstraint.activate([
            bar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            bar.leadingAnchor.constraint(equalTo: view.leadingAnchor), bar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            web.topAnchor.constraint(equalTo: bar.bottomAnchor), web.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor), web.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        timeout = Timer.scheduledTimer(withTimeInterval: CaptureLimits.loadTimeout, repeats: false) { [weak self] _ in
            guard let self, !self.loaded else { return }
            self.finish(.failure(.timeout))
        }
        web.load(URLRequest(url: url))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded = true
        saveButton.isEnabled = true
        title = webView.url?.absoluteString
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if !loaded { finish(.failure(.loadFailed)) }
    }

    @objc private func cancel() { finish(.failure(.cancelled)) }

    @objc private func save() {
        saveButton.isEnabled = false
        Task { @MainActor in
            do {
                let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("capture-\(UUID().uuidString)", isDirectory: true)
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                let png = try await CaptureRender.screenshot(of: web)
                try png.write(to: dir.appendingPathComponent("screenshot.png"))
                let archive: Data = try await withCheckedThrowingContinuation { c in web.createWebArchiveData { c.resume(with: $0) } }
                try archive.write(to: dir.appendingPathComponent("page.webarchive"))
                try CaptureRender.pdf(of: web).write(to: dir.appendingPathComponent("page.pdf"))
                let ua = (try? await web.evaluateJavaScript("navigator.userAgent")) as? String ?? ""
                finish(.success(Result(requestedUrl: url.absoluteString, finalUrl: web.url?.absoluteString ?? url.absoluteString, title: web.title ?? "",
                                       userAgent: ua, capturedAt: Date().timeIntervalSince1970 * 1000, timeZone: TimeZone.current.identifier, dir: dir)))
            } catch {
                finish(.failure(.loadFailed))
            }
        }
    }

    private func finish(_ r: Swift.Result<Result, CaptureError>) {
        guard !finished else { return }
        finished = true
        timeout?.invalidate()
        dismiss(animated: true) { self.completion(r) }
    }
}
