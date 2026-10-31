import Foundation

struct TestFailure: Error { let message: String }
var checkCount = 0
func expect(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    checkCount += 1
    if try !condition() { throw TestFailure(message: message) }
}

// URLSession remains real. Only the external HTTP boundary is replaced.
final class FixtureProtocol: URLProtocol {
    static var status = 200
    static var body = ""
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
        let response = HTTPURLResponse(url: request.url!, statusCode: Self.status, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(Self.body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@main
struct WidgetDataTests {
    static func main() async {
        do { try await run(); print("Widget data: \(checkCount) checks passed") }
        catch { fputs("Widget data regression: \(error)\n", stderr); exit(1) }
    }
    static func run() async throws {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let config = MealWidgetConfiguration(owner: "account-a", token: String(repeating: "a", count: 64),
            expiresAt: now.timeIntervalSince1970 + 86400, baseURL: "https://preview.example.test",
            query: ["lat": "34", "lng": "-118", "calories": "600", "protein": "40", "carbs": "60", "fat": "20"], locked: false)
        let request = try config.request(seed: "test-seed")
        let parts = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!
        let params = Dictionary(uniqueKeysWithValues: parts.queryItems!.map { ($0.name, $0.value!) })
        try expect(parts.path == "/api/restaurants", "must use the app search endpoint")
        try expect(params == config.query.merging(["shuffle": "1", "seed": "test-seed"], uniquingKeysWith: { $1 }), "must preserve targets/location and request shuffle")
        try expect(request.value(forHTTPHeaderField: "Authorization") == "Widget \(config.token)", "must use scoped authorization")
        try expect(request.cachePolicy == .reloadIgnoringLocalCacheData && request.timeoutInterval == 20, "bounded uncached fetch")
        try expect(WidgetData.refreshInterval == 7200, "two-hour background timeline")
        try expect(WidgetData.nextRefresh(configuration: nil, now: now) == now.addingTimeInterval(7200), "logged-out widgets keep the two-hour cadence")
        try expect(WidgetData.nextRefresh(configuration: config, now: now.addingTimeInterval(86400)) == now.addingTimeInterval(93600), "expired credentials must not create a one-minute refresh loop")
        try expect(WidgetData.nextRefresh(configuration: config, now: now.addingTimeInterval(86300)) == now.addingTimeInterval(86400), "refresh at credential expiry when it comes first")

        let restaurant = """
        {"id":"restaurant-first","name":"First restaurant","photoUrl":"https://images.example.test/first.jpg","bestMatch":{"menuItemId":"first-dish","name":"Chicken bowl","calories":617.5,"proteinG":40.25,"carbsG":62.125,"fatG":18.75,"confidence":"HIGH"}}
        """
        let second = restaurant.replacingOccurrences(of: "first", with: "second")
        let payload = "{\"data\":[\(restaurant),\(second)],\"meta\":{\"locked\":false}}"
        let selected = try WidgetData.select(Data(payload.utf8), configuration: config, now: now)
        try expect(selected.dish?.restaurantID == "restaurant-first" && selected.dish?.menuItemID == "first-dish", "select data[0], never a later or random row")
        try expect(selected.dish?.calories == 617.5 && selected.dish?.proteinG == 40.25 &&
                   selected.dish?.carbsG == 62.125 && selected.dish?.fatG == 18.75 && selected.updatedAt == now,
                   "retain all four exact API nutrition values and freshness")
        try expect(selected.dish?.link.absoluteString == "fitsy:///restaurant/restaurant-first?selectedItemId=first-dish", "open the selected dish")
        for confidence in ["HIGH", "MEDIUM", "LOW", "UNKNOWN"] {
            let data = Data(payload.replacingOccurrences(of: "HIGH", with: confidence).utf8)
            let dish = try WidgetData.select(data, configuration: config, now: now).dish!
            try expect([dish.proteinG, dish.carbsG, dish.fatG, dish.calories].map(WidgetDish.number) ==
                       ["40.25", "62.125", "18.75", "617.5"],
                       "display exact API decimals without confidence padding: \(confidence)")
        }
        try expect([600.0, 40.0, 60.0, 20.0].map(WidgetDish.number) == ["600", "40", "60", "20"],
                   "whole API values have no trailing decimal, ranges or approximation prefix")
        try expect([0.0, -0.0, 0.125].map(WidgetDish.number) == ["0", "0", "0.125"],
                   "zero and sub-gram API values are displayed without rounding")
        try expect(selected.dish?.photoUrl == "https://images.example.test/first.jpg", "select the first restaurant photo, not a later result or dish photo")
        let shared = try JSONDecoder().decode(WidgetSnapshot.self, from: JSONEncoder().encode(selected))
        try expect(shared == selected && shared.dish?.photoUrl == selected.dish?.photoUrl, "App Group snapshot round trip retains the photo URL")
        let legacy = payload.replacingOccurrences(of: "\"photoUrl\":\"https://images.example.test/first.jpg\",", with: "")
        let noPhoto = try WidgetData.select(Data(legacy.utf8), configuration: config, now: now)
        try expect(noPhoto.dish?.photoUrl == nil && noPhoto.dish?.name == "Chicken bowl", "restaurants without photos retain their dish")
        let oldSnapshot = try JSONEncoder().encode(noPhoto)
        try expect(try JSONDecoder().decode(WidgetSnapshot.self, from: oldSnapshot).dish?.photoUrl == nil, "older App Group snapshots remain decodable")
        let nullPhoto = payload.replacingOccurrences(of: "\"https://images.example.test/first.jpg\"", with: "null")
        try expect(try WidgetData.select(Data(nullPhoto.utf8), configuration: config, now: now).dish?.photoUrl == nil, "null photos use the solid dark fallback")
        let empty = try WidgetData.select(Data("{\"data\":[],\"meta\":{\"locked\":false}}".utf8), configuration: config, now: now)
        try expect(empty.state == .empty && empty.dish == nil, "empty results")
        let noFirstDish = payload.replacingOccurrences(of: restaurant, with: "{\"id\":\"no-dish\",\"name\":\"No dish\",\"bestMatch\":null}")
        try expect(try WidgetData.select(Data(noFirstDish.utf8), configuration: config, now: now).state == .empty, "do not scan forward to another result")
        let locked = try WidgetData.select(Data("{\"data\":\"untrusted paid data\",\"meta\":{\"locked\":true}}".utf8), configuration: config, now: now)
        try expect(locked.state == .locked && locked.dish == nil && locked.link.absoluteString == "fitsy:///widget?upgrade=1", "locked response contains no dish and opens paywall")

        let settings = URLSessionConfiguration.ephemeral
        settings.protocolClasses = [FixtureProtocol.self]
        let session = URLSession(configuration: settings)
        defer { session.invalidateAndCancel() }
        FixtureProtocol.body = payload
        let fetched = await WidgetData.fetch(configuration: config, cached: nil, session: session, now: now)
        try expect(fetched == selected && FixtureProtocol.requests.count == 1, "actual fetch decodes and selects first result")
        FixtureProtocol.offline = true
        let offline = await WidgetData.fetch(configuration: config, cached: selected, session: session, now: now)
        try expect(offline.dish == selected.dish && offline.offline && offline.updatedAt == now, "offline retains last result without inventing freshness")
        let otherOwner = MealWidgetConfiguration(owner: "account-b", token: config.token, expiresAt: config.expiresAt, baseURL: config.baseURL, query: config.query, locked: false)
        let privateResult = await WidgetData.fetch(configuration: otherOwner, cached: selected, session: session, now: now)
        try expect(privateResult.dish == nil, "never reuse another account cache")
        let otherArea = MealWidgetConfiguration(owner: config.owner, token: config.token, expiresAt: config.expiresAt, baseURL: config.baseURL, query: ["lat": "40", "lng": "-73"], locked: false)
        let moved = await WidgetData.fetch(configuration: otherArea, cached: selected, session: session, now: now)
        try expect(moved.dish == nil, "never reuse a different search context")
        let denied = MealWidgetConfiguration(owner: config.owner, token: config.token, expiresAt: config.expiresAt, baseURL: config.baseURL, query: config.query, locked: true)
        let deniedResult = await WidgetData.fetch(configuration: denied, cached: selected, session: session, now: now)
        try expect(deniedResult.state == .locked && deniedResult.dish == nil, "known local denial clears paid offline data")
        let loggedOut = await WidgetData.fetch(configuration: nil, cached: selected, session: session, now: now)
        try expect(loggedOut.state == .loggedOut && loggedOut.dish == nil, "logout never falls back to paid data")
        let expired = await WidgetData.fetch(configuration: config, cached: selected, session: session, now: now.addingTimeInterval(86400))
        try expect(expired.state == .loggedOut && expired.dish == nil, "expired capability never falls back to paid data")
        FixtureProtocol.offline = false
        for (status, state) in [(401, WidgetSnapshot.State.loggedOut), (403, .locked), (400, .unavailable)] {
            FixtureProtocol.status = status
            let result = await WidgetData.fetch(configuration: config, cached: selected, session: session, now: now)
            try expect(result.state == state && result.dish == nil, "access and client errors invalidate cache: \(status)")
        }
        FixtureProtocol.status = 503
        let serverError = await WidgetData.fetch(configuration: config, cached: selected, session: session, now: now)
        try expect(serverError.offline && serverError.dish == selected.dish, "transient server errors preserve cache")
        FixtureProtocol.status = 200
        FixtureProtocol.body = "{\"data\":[\(restaurant)]}"
        let malformed = await WidgetData.fetch(configuration: config, cached: selected, session: session, now: now)
        try expect(malformed.state == .unavailable && malformed.dish == nil, "missing access verdict fails closed")
    }
}
