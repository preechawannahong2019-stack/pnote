import XCTest
@testable import PnotePlugins

final class SecureKeyTests: XCTestCase {
    /// Keychain access needs a host app on some simulators (errSecMissingEntitlement); skip rather than fail there.
    private func backend() throws -> KeyBackend {
        let b: KeyBackend = SecureEnclaveBackend.isAvailable ? SecureEnclaveBackend(tag: "test.\(UUID())") : KeychainBackend(service: "test.\(UUID())")
        do { _ = try b.wrap(Data([0])) } catch SecureKeyError.keychain(let s) where s == errSecMissingEntitlement {
            throw XCTSkip("keychain unavailable without a host app")
        }
        return b
    }

    func testRoundTrip() throws {
        let k = try backend(); defer { k.delete() }
        let data = Data((0..<40).map { UInt8($0) })
        XCTAssertEqual(try k.unwrap(try k.wrap(data)), data)
    }

    func testDifferentCiphertexts() throws {
        let k = try backend(); defer { k.delete() }
        XCTAssertNotEqual(try k.wrap(Data("same".utf8)), try k.wrap(Data("same".utf8)))
    }

    func testTamperedFails() throws {
        let k = try backend(); defer { k.delete() }
        var w = try k.wrap(Data("secret".utf8))
        w[w.count - 1] ^= 1
        XCTAssertThrowsError(try k.unwrap(w)) { XCTAssertEqual($0 as? SecureKeyError, .decryptFailed) }
    }

    func testDeletedKeyIsMissing() throws {
        let k = try backend()
        let w = try k.wrap(Data("secret".utf8))
        k.delete()
        XCTAssertThrowsError(try k.unwrap(w)) { XCTAssertEqual($0 as? SecureKeyError, .keyMissing) }
    }
}
