import XCTest
@testable import PnotePlugins

final class CacheSweepTests: XCTestCase {
    func testRemovesLeftoversButKeepsARecentCapture() throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let caches = root.appendingPathComponent("Caches"), inbox = root.appendingPathComponent("Documents/Inbox")
        for p in ["export/1/a.pdf", "incoming/u/b.pnote", "capture-old/s.png", "capture-new/p.pdf", "WebKit/x"] {
            let f = caches.appendingPathComponent(p)
            try fm.createDirectory(at: f.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data([1]).write(to: f)
        }
        try fm.createDirectory(at: inbox, withIntermediateDirectories: true)
        try Data([1]).write(to: inbox.appendingPathComponent("c.pnote"))
        try fm.setAttributes([.modificationDate: Date(timeIntervalSinceNow: -7200)], ofItemAtPath: caches.appendingPathComponent("capture-old").path)

        XCTAssertEqual(CacheSweep.sweep(caches: caches, inbox: inbox), 4)
        XCTAssertFalse(fm.fileExists(atPath: caches.appendingPathComponent("export").path))
        XCTAssertFalse(fm.fileExists(atPath: caches.appendingPathComponent("incoming").path))
        XCTAssertFalse(fm.fileExists(atPath: caches.appendingPathComponent("capture-old").path))
        XCTAssertTrue(fm.fileExists(atPath: caches.appendingPathComponent("capture-new").path))
        XCTAssertTrue(fm.fileExists(atPath: caches.appendingPathComponent("WebKit/x").path))
        XCTAssertFalse(fm.fileExists(atPath: inbox.path))
    }
}
