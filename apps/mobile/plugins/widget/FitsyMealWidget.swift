import SwiftUI
import WidgetKit

struct MealEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot
    var photo: CGImage? = nil
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
            settings.urlCredentialStorage = nil
            let session = URLSession(configuration: settings, delegate: WidgetNetworkDelegate(), delegateQueue: nil)
            let snapshot = await WidgetData.fetch(configuration: configuration, cached: WidgetStore.cached, session: session)
            let photo = await WidgetImage.fetch(url: snapshot.dish?.photoUrl, cached: WidgetStore.photo, session: session)
            session.finishTasksAndInvalidate()
            // Logout or a filter edit may have happened while the request was running.
            guard WidgetStore.configuration == configuration else {
                completion(Timeline(entries: [MealEntry(date: Date(), snapshot: WidgetSnapshot(state: .loggedOut))],
                                    policy: .after(Date().addingTimeInterval(60))))
                return
            }
            if snapshot.state == .dish {
                try? WidgetStore.write(snapshot, to: "snapshot.json")
                if let photo { try? WidgetStore.write(photo, to: "photo.json") }
                else { WidgetStore.remove("photo.json") }
            } else { WidgetStore.clearSnapshot() }
            let now = Date()
            let next = WidgetData.nextRefresh(configuration: configuration, now: now)
            // A second, dated entry removes dish data at credential expiry even when offline.
            var entries = [MealEntry(date: now, snapshot: snapshot, photo: photo?.image)]
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
    private var small: Bool { family == .systemSmall }
    private let secondary = Color.white.opacity(0.9)

    var body: some View {
        VStack(alignment: .leading, spacing: small ? 5 : 6) {
            HStack {
                Text("FITSY").font(.system(size: 11, weight: .heavy, design: .rounded)).tracking(2)
                Spacer()
                Image(systemName: entry.snapshot.state == .locked ? "lock.fill" : "shuffle")
                    .font(.system(size: 10)).accessibilityHidden(true)
            }.foregroundStyle(secondary)
            if let dish = entry.snapshot.dish {
                Spacer(minLength: 0)
                VStack(alignment: .leading, spacing: 2) {
                    Text(dish.name).font(.system(size: small ? 15 : 19, weight: .semibold, design: .serif))
                        .lineLimit(2).minimumScaleFactor(0.85)
                    Text(dish.restaurantName).font(.system(size: 10)).foregroundStyle(secondary).lineLimit(1)
                }
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: small ? 2 : 4), spacing: 4) {
                    macro(dish.range(dish.calories), "kcal", "Calories", "kcal")
                    macro(dish.range(dish.proteinG), "P", "Protein", "g")
                    macro(dish.range(dish.carbsG), "C", "Carbs", "g")
                    macro(dish.range(dish.fatG), "F", "Fat", "g")
                }
                if entry.snapshot.offline {
                    HStack(spacing: 3) {
                        Text("Offline ·")
                        Text(entry.snapshot.updatedAt, style: .time)
                    }.font(.system(size: 8)).foregroundStyle(secondary)
                } else { Text("Estimated nutrition").font(.system(size: 8)).foregroundStyle(secondary) }
            } else {
                Spacer(minLength: 0)
                Text(message.title).font(.system(.headline, design: .serif)).lineLimit(2)
                Text(message.detail).font(.caption).foregroundStyle(secondary).lineLimit(3)
                Spacer(minLength: 0)
            }
        }
        .padding(small ? 12 : 14)
        .foregroundStyle(.white)
        .widgetURL(entry.snapshot.link)
        .containerBackground(for: .widget) {
            GeometryReader { geometry in
                ZStack {
                    Color(red: 0.07, green: 0.10, blue: 0.09)
                    if let photo = entry.photo {
                        Image(decorative: photo, scale: 1).resizable().scaledToFill()
                            .frame(width: geometry.size.width, height: geometry.size.height).clipped()
                        // Even a white photo stays dark enough for the smallest text.
                        LinearGradient(colors: [.black.opacity(0.62), .black.opacity(0.76), .black.opacity(0.94)],
                                       startPoint: .top, endPoint: .bottom)
                    }
                }
            }
        }
    }
    private func macro(_ value: String, _ label: String, _ accessibleLabel: String, _ unit: String) -> some View {
        let number = value + (unit == "g" ? "g" : "")
        return HStack(alignment: .firstTextBaseline, spacing: 3) {
            if unit == "g" { Text(label).foregroundStyle(secondary) }
            Text(number).fontWeight(.semibold)
            if unit == "kcal" { Text(label).foregroundStyle(secondary) }
        }
        .font(.system(size: small ? 11 : 13))
        .lineLimit(1).minimumScaleFactor(0.75)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(accessibleLabel), \(value) \(unit), estimated")
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
            .contentMarginsDisabled()
            .containerBackgroundRemovable(false)
    }
}
