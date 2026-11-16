import Foundation

/// Deletes temporary plaintext files a killed process left behind: Caches/export, Caches/incoming, Caches/capture-*
/// older than `captureGrace` (a capture may still be open), and Documents/Inbox (copies iOS made for "Open in").
public enum CacheSweep {
    @discardableResult
    public static func sweep(caches: URL, inbox: URL?, now: Date = Date(), captureGrace: TimeInterval = 3600) -> Int {
        let fm = FileManager.default
        var removed = 0
        let items = (try? fm.contentsOfDirectory(at: caches, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
        for u in items {
            let n = u.lastPathComponent
            var stale = n == "export" || n == "incoming"
            if n.hasPrefix("capture-") {
                let m = (try? u.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? .distantPast
                stale = now.timeIntervalSince(m) > captureGrace
            }
            if stale, (try? fm.removeItem(at: u)) != nil { removed += 1 }
        }
        if let inbox, fm.fileExists(atPath: inbox.path), (try? fm.removeItem(at: inbox)) != nil { removed += 1 }
        return removed
    }
}
