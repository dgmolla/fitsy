import Foundation

struct MealWidgetConfiguration: Codable, Equatable {
    let owner: String
    let token: String
    let expiresAt: Double
    let baseURL: String
    let query: [String: String]
    let locked: Bool

    // Token renewal does not change the search, but accounts and filters do.
    var context: String {
        ([owner, baseURL] + query.keys.sorted().map { "\($0)=\(query[$0]!)" }).joined(separator: "|")
    }

    func request(seed: String = UUID().uuidString) throws -> URLRequest {
        guard var url = URLComponents(string: baseURL), url.scheme == "https",
              url.host != nil, url.user == nil, url.password == nil,
              url.path.isEmpty, url.query == nil, url.fragment == nil else { throw WidgetDataError.invalidConfiguration }
        url.path = "/api/restaurants"
        let allowed = ["lat", "lng", "calories", "protein", "carbs", "fat"]
        url.queryItems = allowed.compactMap { key in query[key].map { URLQueryItem(name: key, value: $0) } }
        url.queryItems! += [URLQueryItem(name: "shuffle", value: "1"), URLQueryItem(name: "seed", value: seed)]
        guard let address = url.url else { throw WidgetDataError.invalidConfiguration }
        var request = URLRequest(url: address, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        request.setValue("Widget \(token)", forHTTPHeaderField: "Authorization")
        return request
    }
}

enum WidgetDataError: Error { case invalidConfiguration, invalidResponse }

struct WidgetDish: Codable, Equatable {
    let restaurantID: String
    let restaurantName: String
    let menuItemID: String
    let name: String
    let calories: Double
    let proteinG: Double
    let carbsG: Double
    let fatG: Double
    let confidence: String

    var link: URL {
        var url = URLComponents()
        url.scheme = "fitsy"
        url.host = ""
        url.path = "/restaurant/\(restaurantID)"
        url.queryItems = [URLQueryItem(name: "selectedItemId", value: menuItemID)]
        return url.url!
    }

    func range(_ value: Double) -> String {
        let tolerance = confidence == "HIGH" ? 0.1 : confidence == "MEDIUM" ? 0.2 : 0.3
        return "\(Int(floor(value * (1 - tolerance))))-\(Int(ceil(value * (1 + tolerance))))"
    }
}

struct WidgetSnapshot: Codable, Equatable {
    enum State: String, Codable { case dish, loggedOut, locked, empty, needsLocation, unavailable }
    let state: State
    var dish: WidgetDish? = nil
    var updatedAt: Date = Date()
    var offline: Bool = false
    var context: String = ""

    var link: URL {
        dish?.link ?? URL(string: state == .locked ? "fitsy:///widget?upgrade=1" : "fitsy:///widget")!
    }
}

private struct AccessEnvelope: Decodable {
    struct Meta: Decodable { let locked: Bool }
    let meta: Meta
}
private struct SearchEnvelope: Decodable {
    struct Restaurant: Decodable {
        struct Match: Decodable {
            let menuItemId: String
            let name: String
            let calories: Double
            let proteinG: Double
            let carbsG: Double
            let fatG: Double
            let confidence: String
        }
        let id: String
        let name: String
        let bestMatch: Match?
    }
    let data: [Restaurant]
}

// Shared by the actual timeline provider and executable native regressions.
enum WidgetData {
    static let refreshInterval: TimeInterval = 2 * 60 * 60

    static func nextRefresh(configuration: MealWidgetConfiguration?, now: Date) -> Date {
        let next = now.addingTimeInterval(refreshInterval)
        guard let configuration, configuration.expiresAt > now.timeIntervalSince1970 else { return next }
        return min(next, Date(timeIntervalSince1970: configuration.expiresAt))
    }

    static func select(_ data: Data, configuration: MealWidgetConfiguration, now: Date) throws -> WidgetSnapshot {
        let decoder = JSONDecoder()
        // Read the access verdict first. Never keep a paid cache on a locked response.
        if try decoder.decode(AccessEnvelope.self, from: data).meta.locked {
            return WidgetSnapshot(state: .locked, updatedAt: now, context: configuration.context)
        }
        let first = try decoder.decode(SearchEnvelope.self, from: data).data.first
        guard let restaurant = first, let match = restaurant.bestMatch else {
            return WidgetSnapshot(state: .empty, updatedAt: now, context: configuration.context)
        }
        guard !restaurant.id.isEmpty, !restaurant.name.isEmpty, !match.menuItemId.isEmpty, !match.name.isEmpty,
              [match.calories, match.proteinG, match.carbsG, match.fatG].allSatisfy({ $0.isFinite && $0 >= 0 && $0 < 100_000 }) else {
            throw WidgetDataError.invalidResponse
        }
        let dish = WidgetDish(restaurantID: restaurant.id, restaurantName: restaurant.name, menuItemID: match.menuItemId,
                              name: match.name, calories: match.calories, proteinG: match.proteinG,
                              carbsG: match.carbsG, fatG: match.fatG, confidence: match.confidence)
        return WidgetSnapshot(state: .dish, dish: dish, updatedAt: now, context: configuration.context)
    }

    static func fetch(configuration: MealWidgetConfiguration?, cached: WidgetSnapshot?,
                      session: URLSession, now: Date = Date()) async -> WidgetSnapshot {
        guard let configuration, configuration.expiresAt > now.timeIntervalSince1970 else { return WidgetSnapshot(state: .loggedOut) }
        guard configuration.query["lat"] != nil, configuration.query["lng"] != nil else { return WidgetSnapshot(state: .needsLocation) }
        let fallback: () -> WidgetSnapshot = {
            if !configuration.locked, var last = cached, last.context == configuration.context, last.state == .dish {
                last.offline = true
                return last
            }
            return WidgetSnapshot(state: configuration.locked ? .locked : .unavailable)
        }
        do {
            let (data, response) = try await session.data(for: configuration.request())
            guard let response = response as? HTTPURLResponse else { return WidgetSnapshot(state: .unavailable) }
            if response.statusCode == 401 { return WidgetSnapshot(state: .loggedOut) }
            if response.statusCode == 403 { return WidgetSnapshot(state: .locked) }
            if response.statusCode == 429 || response.statusCode >= 500 { return fallback() }
            guard response.statusCode == 200 else { return WidgetSnapshot(state: .unavailable) }
            // A malformed access envelope cannot prove continued paid access.
            return (try? select(data, configuration: configuration, now: now)) ?? WidgetSnapshot(state: .unavailable)
        } catch { return fallback() }
    }
}

// Do not forward the capability to a redirect destination.
final class WidgetNetworkDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
