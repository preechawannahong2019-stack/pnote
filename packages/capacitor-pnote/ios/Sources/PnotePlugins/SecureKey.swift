import CryptoKit
import Foundation
import Security

public enum SecureKeyError: Error, Equatable {
    case keyMissing
    case decryptFailed
    case keychain(OSStatus)
}

/// Where the device key lives. Secure Enclave when the device has one; otherwise a this-device-only Keychain item.
public protocol KeyBackend {
    var hardware: String { get }
    func wrap(_ data: Data) throws -> Data
    func unwrap(_ data: Data) throws -> Data
    func delete()
}

/// P-256 key inside the Secure Enclave; data is wrapped with ECIES (cofactor, variable IV, X9.63 SHA-256, AES-GCM).
public final class SecureEnclaveBackend: KeyBackend {
    public let hardware = "secure-enclave"
    private let tag: Data
    private let algorithm = SecKeyAlgorithm.eciesEncryptionCofactorVariableIVX963SHA256AESGCM

    public init(tag: String) { self.tag = Data(tag.utf8) }

    public static var isAvailable: Bool { SecureEnclave.isAvailable }

    private func privateKey(create: Bool) throws -> SecKey {
        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: tag,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecReturnRef as String: true,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecSuccess, let item { return (item as! SecKey) }
        if status != errSecItemNotFound { throw SecureKeyError.keychain(status) }
        if !create { throw SecureKeyError.keyMissing }
        var error: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, .privateKeyUsage, &error) else {
            throw SecureKeyError.keychain(errSecParam)
        }
        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
            kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
            kSecPrivateKeyAttrs as String: [
                kSecAttrIsPermanent as String: true,
                kSecAttrApplicationTag as String: tag,
                kSecAttrAccessControl as String: access,
            ],
        ]
        guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else { throw SecureKeyError.keychain(errSecParam) }
        return key
    }

    public func wrap(_ data: Data) throws -> Data {
        guard let pub = SecKeyCopyPublicKey(try privateKey(create: true)) else { throw SecureKeyError.keychain(errSecParam) }
        var error: Unmanaged<CFError>?
        guard let out = SecKeyCreateEncryptedData(pub, algorithm, data as CFData, &error) else { throw SecureKeyError.keychain(errSecParam) }
        return out as Data
    }

    public func unwrap(_ data: Data) throws -> Data {
        let key = try privateKey(create: false)
        var error: Unmanaged<CFError>?
        guard let out = SecKeyCreateDecryptedData(key, algorithm, data as CFData, &error) else { throw SecureKeyError.decryptFailed }
        return out as Data
    }

    public func delete() {
        SecItemDelete([kSecClass as String: kSecClassKey, kSecAttrApplicationTag as String: tag] as CFDictionary)
    }
}

/// Random 256-bit key in a this-device-only Keychain item; AES-GCM via CryptoKit (devices/simulators without a Secure Enclave).
public final class KeychainBackend: KeyBackend {
    public let hardware = "keychain"
    private let service: String

    public init(service: String) { self.service = service }

    private var baseQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "device-key"]
    }

    private func key(create: Bool) throws -> SymmetricKey {
        var query = baseQuery
        query[kSecReturnData as String] = true
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecSuccess, let data = item as? Data { return SymmetricKey(data: data) }
        if status != errSecItemNotFound { throw SecureKeyError.keychain(status) }
        if !create { throw SecureKeyError.keyMissing }
        let key = SymmetricKey(size: .bits256)
        var add = baseQuery
        add[kSecValueData as String] = key.withUnsafeBytes { Data($0) }
        add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let addStatus = SecItemAdd(add as CFDictionary, nil)
        if addStatus != errSecSuccess { throw SecureKeyError.keychain(addStatus) }
        return key
    }

    public func wrap(_ data: Data) throws -> Data {
        guard let combined = try AES.GCM.seal(data, using: key(create: true)).combined else { throw SecureKeyError.decryptFailed }
        return combined
    }

    public func unwrap(_ data: Data) throws -> Data {
        let k = try key(create: false)
        do { return try AES.GCM.open(AES.GCM.SealedBox(combined: data), using: k) } catch { throw SecureKeyError.decryptFailed }
    }

    public func delete() { SecItemDelete(baseQuery as CFDictionary) }
}

public enum SecureKey {
    public static let tag = "app.pnote.notes.device-key.v1"
    public static func backend() -> KeyBackend {
        SecureEnclaveBackend.isAvailable ? SecureEnclaveBackend(tag: tag) : KeychainBackend(service: tag)
    }
}
