// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "PnoteCapacitorPnote",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "PnoteCapacitorPnote", targets: ["PnotePlugins"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "PnotePlugins",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/PnotePlugins"),
        .testTarget(
            name: "PnotePluginsTests",
            dependencies: ["PnotePlugins"],
            path: "ios/Tests/PnotePluginsTests")
    ]
)
