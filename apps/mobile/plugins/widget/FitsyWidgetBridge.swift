import Foundation
import WidgetKit
import React

@objc(FitsyWidgetBridge)
final class FitsyWidgetBridge: NSObject {
    @objc static func requiresMainQueueSetup() -> Bool { false }

    @objc(configure:resolver:rejecter:)
    func configure(_ json: String, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        do {
            let next = try JSONDecoder().decode(MealWidgetConfiguration.self, from: Data(json.utf8))
            let old = WidgetStore.configuration
            guard next != old else { resolve(nil); return }
            // A different account, target or area must not inherit an old dish.
            if next.locked || next.context != old?.context { WidgetStore.clearSnapshot() }
            try WidgetStore.write(next, to: "configuration.json")
            WidgetCenter.shared.reloadTimelines(ofKind: WidgetStore.kind)
            resolve(nil)
        } catch { reject("WIDGET_CONFIGURATION", "Could not update widget", nil) }
    }

    @objc(clear:rejecter:)
    func clear(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        WidgetStore.remove("configuration.json")
        WidgetStore.clearSnapshot()
        WidgetCenter.shared.reloadTimelines(ofKind: WidgetStore.kind)
        resolve(nil)
    }
}
