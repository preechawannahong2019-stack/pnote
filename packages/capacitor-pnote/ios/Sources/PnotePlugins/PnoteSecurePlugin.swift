import Capacitor
import Foundation

@objc(PnoteSecurePlugin)
public class PnoteSecurePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PnoteSecurePlugin"
    public let jsName = "PnoteSecure"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "wrap", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unwrap", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "excludeFromBackup", returnType: CAPPluginReturnPromise),
    ]

    private lazy var key: KeyBackend = SecureKey.backend()

    @objc func status(_ call: CAPPluginCall) {
        call.resolve(["available": true, "hardware": key.hardware])
    }

    @objc func wrap(_ call: CAPPluginCall) {
        guard let input = Data(base64Encoded: call.getString("data") ?? "") else { return call.reject("bad base64", "WRAP_FAILED") }
        do { call.resolve(["data": try key.wrap(input).base64EncodedString()]) } catch { call.reject("wrap failed", "WRAP_FAILED", error) }
    }

    @objc func unwrap(_ call: CAPPluginCall) {
        guard let input = Data(base64Encoded: call.getString("data") ?? "") else { return call.reject("bad base64", "DECRYPT_FAILED") }
        do {
            call.resolve(["data": try key.unwrap(input).base64EncodedString()])
        } catch SecureKeyError.keyMissing {
            call.reject("device key is missing", "KEY_MISSING")
        } catch {
            call.reject("data could not be decrypted", "DECRYPT_FAILED", error)
        }
    }

    /// Capacitor's Directory.Data is the app's Documents directory on iOS.
    @objc func excludeFromBackup(_ call: CAPPluginCall) {
        do {
            let docs = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            var url = docs.appendingPathComponent(call.getString("path") ?? "", isDirectory: true)
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try url.setResourceValues(values)
            call.resolve()
        } catch {
            call.reject("could not exclude from backup", "BACKUP_EXCLUDE_FAILED", error)
        }
    }
}
