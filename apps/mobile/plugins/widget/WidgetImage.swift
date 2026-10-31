import Foundation
import ImageIO
import UniformTypeIdentifiers

// One downsampled restaurant photo, persisted beside snapshot.json in the App Group.
struct WidgetPhoto: Codable {
    let url: String
    let data: Data

    var image: CGImage? {
        guard data.count <= WidgetImage.maximumBytes,
              let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        return WidgetImage.thumbnail(source)
    }
}

enum WidgetImage {
    static let maximumBytes = 5 * 1024 * 1024
    static let maximumPixels = 1024

    static func thumbnail(_ source: CGImageSource) -> CGImage? {
        CGImageSourceCreateThumbnailAtIndex(source, 0, [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maximumPixels,
            kCGImageSourceShouldCacheImmediately: true,
        ] as CFDictionary)
    }

    static func fetch(url rawURL: String?, cached: WidgetPhoto?, session: URLSession) async -> WidgetPhoto? {
        guard let rawURL, let url = URL(string: rawURL), url.scheme == "https", url.host != nil,
              url.user == nil, url.password == nil else { return nil }
        if let cached, cached.url == rawURL, cached.image != nil { return cached }
        do {
            // The photo request carries no widget capability, cookies or app session.
            var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 8)
            request.setValue("image/*", forHTTPHeaderField: "Accept")
            let (bytes, response) = try await session.bytes(for: request)
            defer { bytes.task.cancel() }
            guard let response = response as? HTTPURLResponse, response.statusCode == 200,
                  response.expectedContentLength <= Int64(maximumBytes) else { return nil }
            var data = Data()
            for try await byte in bytes {
                guard data.count < maximumBytes else { return nil }
                data.append(byte)
            }
            guard let source = CGImageSourceCreateWithData(data as CFData, nil),
                  let image = thumbnail(source) else { return nil }
            let encoded = NSMutableData()
            guard let destination = CGImageDestinationCreateWithData(encoded, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
            CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
            guard CGImageDestinationFinalize(destination), encoded.length <= maximumBytes else { return nil }
            return WidgetPhoto(url: rawURL, data: encoded as Data)
        } catch { return nil }
    }
}
