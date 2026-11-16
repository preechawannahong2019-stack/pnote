import Capacitor
import Foundation

/// Files opened with / shared to PNote ("Open in", "Copy to PNote"). Each is copied into Caches/incoming/<uuid>/<name>
/// and reported to JS as a retained "file" event { name, mime, path } (path relative to Caches).
@objc(PnoteIncomingPlugin)
public class PnoteIncomingPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PnoteIncomingPlugin"
    public let jsName = "PnoteIncoming"
    public let pluginMethods: [CAPPluginMethod] = []

    public override func load() {
        let fm = FileManager.default
        let inbox = fm.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Inbox")
        CacheSweep.sweep(caches: fm.urls(for: .cachesDirectory, in: .userDomainMask)[0], inbox: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(opened(_:)), name: .capacitorOpenURL, object: nil)
        if let url = ApplicationDelegateProxy.shared.lastURL { handle(url) } // the launch file may be in Inbox: moved out first
        CacheSweep.sweep(caches: fm.temporaryDirectory.appendingPathComponent("none"), inbox: inbox)
    }

    @objc private func opened(_ n: Notification) {
        guard let info = n.object as? [String: Any], let url = info["url"] as? URL else { return }
        handle(url)
    }

    private func handle(_ url: URL) {
        guard url.isFileURL else { return }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let dir = caches.appendingPathComponent("incoming/\(UUID().uuidString)", isDirectory: true)
        let name = url.lastPathComponent.replacingOccurrences(of: "/", with: "_")
        let out = dir.appendingPathComponent(name.isEmpty ? "file" : name)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            // iOS already copied "Open in" files into Documents/Inbox (which is backed up): move those, copy others
            if url.path.contains("/Documents/Inbox/") { try FileManager.default.moveItem(at: url, to: out) }
            else { try FileManager.default.copyItem(at: url, to: out) }
        } catch { return }
        let mime: String
        switch url.pathExtension.lowercased() {
        case "pdf": mime = "application/pdf"
        case "png": mime = "image/png"
        case "jpg", "jpeg": mime = "image/jpeg"
        case "heic", "heif": mime = "image/heic"
        case "pnote": mime = "application/x-pnote-backup"
        default: mime = ""
        }
        notifyListeners("file", data: ["name": name, "mime": mime, "path": out.path.replacingOccurrences(of: caches.path + "/", with: "")], retainUntilConsumed: true)
    }
}
