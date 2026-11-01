import Foundation

enum WidgetStore {
    static let kind = "FitsyMealWidget"
    static let group = "group.com.fitsy.mobile.widget"
    private static func file(_ name: String) -> URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?.appendingPathComponent(name)
    }
    static func read<T: Decodable>(_ name: String, as type: T.Type) -> T? {
        guard let url = file(name), let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }
    static func write<T: Encodable>(_ value: T, to name: String) throws {
        guard let url = file(name) else { throw WidgetDataError.invalidConfiguration }
        try JSONEncoder().encode(value).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    static func remove(_ name: String) {
        if let url = file(name) { try? FileManager.default.removeItem(at: url) }
    }
    static var configuration: MealWidgetConfiguration? { read("configuration.json", as: MealWidgetConfiguration.self) }
    static var cached: WidgetSnapshot? { read("snapshot.json", as: WidgetSnapshot.self) }
    static var photo: WidgetPhoto? { read("photo.json", as: WidgetPhoto.self) }

    static func clearSnapshot() {
        remove("snapshot.json")
        remove("photo.json")
    }
}
