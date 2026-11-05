import StoreKit
import StoreKitTest
import XCTest

// Hosted by the real Release app. This test never creates or clears purchases.
final class FitsyStoreKitTests: XCTestCase {
    func testActivateLocalStoreKit() async throws {
        XCTAssertEqual(Bundle.main.bundleIdentifier, "com.fitsy.mobile")
        let configuration = try XCTUnwrap(Bundle(for: Self.self).url(
            forResource: "FitsyIssue718", withExtension: "storekit"
        ))
        let session = try SKTestSession(contentsOf: configuration)
        XCTAssertEqual(session.storefront, "USA")
        XCTAssertEqual(session.timeRate, .monthlyRenewalEveryFiveMinutes)
        XCTAssertFalse(session.disableDialogs)

        let identifiers: Set<String> = [
            "com.fitsy.mobile.monthly",
            "com.fitsy.mobile.yearly",
            "com.fitsy.mobile.yearly_discount",
        ]
        let products = try await Product.products(for: identifiers)
        XCTAssertEqual(Set(products.map(\.id)), identifiers)

        let verification = try await AppTransaction.shared
        guard case .verified(let transaction) = verification else {
            XCTFail("StoreKit app transaction was not verified")
            return
        }
        XCTAssertEqual(transaction.bundleID, "com.fitsy.mobile")
        XCTAssertEqual(transaction.environment, .xcode)
        print("FITSY_STOREKIT_ACTIVATION environment=\(transaction.environment) products=\(products.count)")
        withExtendedLifetime(session) {}
    }
}
