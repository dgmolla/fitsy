import Foundation
import ImageIO
import UniformTypeIdentifiers

struct ImageTestFailure: Error { let message: String }
var checkCount = 0
func expect(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    checkCount += 1
    if try !condition() { throw ImageTestFailure(message: message) }
}

final class PhotoProtocol: URLProtocol {
    static var status = 200
    static var body = Data()
    static var length: String? = nil
    static var offline = false
    static var requests: [URLRequest] = []
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.requests.append(request)
        if Self.offline {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        let headers = Self.length.map { ["Content-Length": $0] }
        let response = HTTPURLResponse(url: request.url!, statusCode: Self.status, httpVersion: nil, headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@main
struct WidgetImageTests {
    static func main() async {
        do { try await run(); print("Widget photo: \(checkCount) checks passed") }
        catch { fputs("Widget photo regression: \(error)\n", stderr); exit(1) }
    }
    static func run() async throws {
        let settings = URLSessionConfiguration.ephemeral
        settings.protocolClasses = [PhotoProtocol.self]
        settings.urlCache = nil
        settings.httpCookieStorage = nil
        settings.urlCredentialStorage = nil
        let session = URLSession(configuration: settings, delegate: WidgetNetworkDelegate(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        let url = "https://images.example.test/restaurant.jpg"
        let context = CGContext(data: nil, width: 2048, height: 1024, bitsPerComponent: 8, bytesPerRow: 0,
                                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
        context.setFillColor(CGColor(gray: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: 2048, height: 1024))
        let data = NSMutableData()
        let destination = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil)!
        CGImageDestinationAddImage(destination, context.makeImage()!, nil)
        try expect(CGImageDestinationFinalize(destination), "generate a real bright restaurant image fixture")
        PhotoProtocol.body = data as Data
        let photo = await WidgetImage.fetch(url: url, cached: nil, session: session)
        try expect(photo?.url == url && photo?.image != nil, "download and decode the restaurant photo")
        try expect(photo?.image?.width == 1024 && photo?.image?.height == 512, "downsample large photos with their aspect ratio intact")
        try expect(photo!.data.count < WidgetImage.maximumBytes, "disk cache stays bounded")
        let request = PhotoProtocol.requests[0]
        try expect(request.value(forHTTPHeaderField: "Authorization") == nil && request.value(forHTTPHeaderField: "Cookie") == nil, "photo CDN never receives a widget token or account cookie")
        try expect(request.timeoutInterval == 8 && request.cachePolicy == .reloadIgnoringLocalCacheData, "photo download has a separate bounded request")
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("photo.json")
        try JSONEncoder().encode(photo!).write(to: file, options: .atomic)
        let persisted = try JSONDecoder().decode(WidgetPhoto.self, from: Data(contentsOf: file))
        PhotoProtocol.offline = true
        let offline = await WidgetImage.fetch(url: url, cached: persisted, session: session)
        try expect(offline?.image != nil && PhotoProtocol.requests.count == 1, "persisted photo works offline without another download")
        let wrongPhoto = await WidgetImage.fetch(url: "https://images.example.test/another.jpg", cached: persisted, session: session)
        try expect(wrongPhoto == nil, "never show a different restaurant's cached photo")
        let missing = await WidgetImage.fetch(url: nil, cached: persisted, session: session)
        try expect(missing == nil, "missing URL clears the previous image instead of inheriting it")
        let count = PhotoProtocol.requests.count
        for invalid in ["http://images.example.test/a.jpg", "file:///tmp/a.jpg", "https://user:secret@images.example.test/a.jpg", ""] {
            let result = await WidgetImage.fetch(url: invalid, cached: nil, session: session)
            try expect(result == nil && PhotoProtocol.requests.count == count, "invalid or credential-bearing URL must not download")
        }
        PhotoProtocol.offline = false
        let corrupt = WidgetPhoto(url: url, data: Data("not an image".utf8))
        let repaired = await WidgetImage.fetch(url: url, cached: corrupt, session: session)
        try expect(repaired?.image != nil, "a corrupt cached file is replaced by a valid download")
        PhotoProtocol.status = 404
        let unavailable = await WidgetImage.fetch(url: url, cached: nil, session: session)
        try expect(unavailable == nil, "failed downloads fall back to the dark card")
        PhotoProtocol.status = 200
        PhotoProtocol.body = Data("<html>not a photo</html>".utf8)
        let invalid = await WidgetImage.fetch(url: url, cached: nil, session: session)
        try expect(invalid == nil, "non-image responses fall back to the dark card")
        PhotoProtocol.length = String(WidgetImage.maximumBytes + 1)
        let largeHeader = await WidgetImage.fetch(url: url, cached: nil, session: session)
        try expect(largeHeader == nil, "reject oversized content length")
        PhotoProtocol.length = nil
        PhotoProtocol.body = Data(repeating: 0, count: WidgetImage.maximumBytes + 1)
        let largeBody = await WidgetImage.fetch(url: url, cached: nil, session: session)
        try expect(largeBody == nil, "streaming byte limit also covers missing content length")
        let oversized = WidgetPhoto(url: url, data: PhotoProtocol.body)
        try expect(oversized.image == nil, "reject oversized disk cache before decoding")
    }
}
