import SwiftUI
import WidgetKit

struct MealEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot
}

struct MealProvider: TimelineProvider {
    func placeholder(in context: Context) -> MealEntry {
        MealEntry(date: Date(), snapshot: WidgetSnapshot(state: .needsLocation))
    }
    func getSnapshot(in context: Context, completion: @escaping (MealEntry) -> Void) {
        // Gallery previews never expose account data.
        completion(placeholder(in: context))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<MealEntry>) -> Void) {
        Task {
            let configuration = WidgetStore.configuration
            let settings = URLSessionConfiguration.ephemeral
            settings.urlCache = nil
            settings.httpCookieStorage = nil
            let session = URLSession(configuration: settings, delegate: WidgetNetworkDelegate(), delegateQueue: nil)
            let snapshot = await WidgetData.fetch(configuration: configuration, cached: WidgetStore.cached, session: session)
            session.finishTasksAndInvalidate()
            // Logout or a filter edit may have happened while the request was running.
            guard WidgetStore.configuration == configuration else {
                completion(Timeline(entries: [MealEntry(date: Date(), snapshot: WidgetSnapshot(state: .loggedOut))],
                                    policy: .after(Date().addingTimeInterval(60))))
                return
            }
            if snapshot.state == .dish { try? WidgetStore.write(snapshot, to: "snapshot.json") }
            else { WidgetStore.remove("snapshot.json") }
            let now = Date()
            let next = WidgetData.nextRefresh(configuration: configuration, now: now)
            // A second, dated entry removes dish data at credential expiry even when offline.
            var entries = [MealEntry(date: now, snapshot: snapshot)]
            if let configuration, configuration.expiresAt > now.timeIntervalSince1970 {
                entries.append(MealEntry(date: Date(timeIntervalSince1970: configuration.expiresAt), snapshot: WidgetSnapshot(state: .loggedOut)))
            }
            completion(Timeline(entries: entries, policy: .after(next)))
        }
    }
}

struct MealWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: MealEntry
    private let green = Color(red: 0.12, green: 0.24, blue: 0.19)

    var body: some View {
        VStack(alignment: .leading, spacing: family == .systemSmall ? 6 : 8) {
            HStack {
                Text("FITSY").font(.system(size: 11, weight: .heavy, design: .rounded)).tracking(2)
                Spacer()
                Image(systemName: entry.snapshot.state == .locked ? "lock.fill" : "shuffle").font(.caption)
            }.foregroundStyle(green)
            if let dish = entry.snapshot.dish {
                Text(dish.name).font(.system(family == .systemSmall ? .headline : .title3, design: .serif).weight(.semibold))
                    .lineLimit(2).minimumScaleFactor(0.85)
                Text(dish.restaurantName).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                Spacer(minLength: 0)
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    macro(dish.range(dish.calories), "kcal")
                    macro(dish.range(dish.proteinG), "g protein")
                    if family == .systemMedium {
                        macro(dish.range(dish.carbsG), "g carbs")
                        macro(dish.range(dish.fatG), "g fat")
                    }
                }
                if entry.snapshot.offline {
                    HStack(spacing: 3) {
                        Text("Offline ·")
                        Text(entry.snapshot.updatedAt, style: .time)
                    }.font(.system(size: 9)).foregroundStyle(.secondary)
                } else { Text("Estimated nutrition").font(.system(size: 9)).foregroundStyle(.secondary) }
            } else {
                Spacer(minLength: 0)
                Text(message.title).font(.system(.headline, design: .serif)).lineLimit(2)
                Text(message.detail).font(.caption).foregroundStyle(.secondary).lineLimit(3)
                Spacer(minLength: 0)
            }
        }
        .widgetURL(entry.snapshot.link)
        .containerBackground(Color(red: 0.992, green: 0.984, blue: 0.969), for: .widget)
    }
    private func macro(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.system(size: family == .systemSmall ? 13 : 17, weight: .semibold)).minimumScaleFactor(0.8).lineLimit(1)
            Text(label).font(.system(size: 9)).foregroundStyle(.secondary)
        }
    }
    private var message: (title: String, detail: String) {
        switch entry.snapshot.state {
        case .locked: return ("A little inspiration.", "Unlock Fitsy to find your next meal.")
        case .loggedOut: return ("Your next meal awaits.", "Open Fitsy to sign in.")
        case .empty: return ("Nothing nearby yet.", "Open Fitsy to try another area or target.")
        case .needsLocation: return ("Find your next meal.", "Open Search in Fitsy to choose your area.")
        default: return ("A little offline.", "Open Fitsy or check back in a bit.")
        }
    }
}

@main
struct FitsyMealWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetStore.kind, provider: MealProvider()) { MealWidgetView(entry: $0) }
            .configurationDisplayName("Your next meal")
            .description("A fitting dish near your last search area. Requires a Fitsy subscription.")
            .supportedFamilies([.systemSmall, .systemMedium])
    }
}
