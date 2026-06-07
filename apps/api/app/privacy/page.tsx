import type { Metadata } from "next";
import styles from "../legal.module.css";
import { Nav } from "@/components/Nav";
import { LegalFooter } from "@/components/LegalFooter";

export const metadata: Metadata = {
  title: "Privacy Policy — Fitsy",
  description:
    "How Fitsy collects, uses, and protects your data. We do not sell your data.",
};

const PRIVACY_EMAIL = "privacy@fitsy.app";
const EFFECTIVE_DATE = "June 6, 2026";

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <Nav />
      <article className={styles.container}>
        <span className={styles.kicker}>Legal</span>
        <h1 className={styles.title}>Privacy Policy</h1>
        <p className={styles.updated}>Last updated {EFFECTIVE_DATE}</p>

        <p className={styles.lede}>
          Fitsy helps you find restaurants near you with meals that match your
          macro targets. This policy explains what we collect, why, and the
          control you have over it. The short version: we don&rsquo;t sell your
          data, and we collect as little as we can to make the app work.
        </p>

        <section className={styles.section}>
          <h2>Information we collect</h2>

          <h3>Account information</h3>
          <p>
            When you sign in with Apple or Google, we receive your name and
            email address to create and identify your account. If you use Sign
            in with Apple&rsquo;s &ldquo;Hide My Email&rdquo; feature, we only
            ever see the relay address Apple provides.
          </p>

          <h3>Location</h3>
          <p>
            With your permission, Fitsy uses your device&rsquo;s precise
            location <strong>while you are using the app</strong> to find and
            rank nearby restaurants. We do not track your location in the
            background, and we do not store your location history on our
            servers. You can revoke location access at any time in your
            device&rsquo;s Settings.
          </p>

          <h3>Macro targets and saved items</h3>
          <p>
            Your protein, carb, and fat targets and your saved restaurants are
            stored so the app can rank results for you and sync across sessions.
            These are used only to power features inside Fitsy.
          </p>

          <h3>Subscription information</h3>
          <p>
            Subscriptions are processed by Apple through the App Store. We
            receive a transaction identifier and your subscription status from
            Apple to unlock features. We never receive or store your payment
            card details.
          </p>

          <h3>Usage analytics</h3>
          <p>
            We use PostHog to collect anonymized, aggregated product analytics
            (for example, which screens are used and which features are popular)
            so we can improve the app. We do not use this data to track you
            across other companies&rsquo; apps or websites, and Fitsy does not
            use the Advertising Identifier (IDFA).
          </p>
        </section>

        <section className={styles.section}>
          <h2>How we use your information</h2>
          <ul>
            <li>To show and rank restaurants that fit your macro targets.</li>
            <li>To create and secure your account.</li>
            <li>To manage your subscription and unlock paid features.</li>
            <li>To understand product usage in aggregate and improve Fitsy.</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>What we don&rsquo;t do</h2>
          <p>
            We do not sell your personal data. We do not share it with
            advertisers or data brokers. We do not use it for cross-app or
            cross-site tracking.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Your rights and choices</h2>
          <p>
            You can access, export, or delete your data at any time. To delete
            your account and all associated data, open Fitsy, go to{" "}
            <strong>Profile &rarr; Delete account</strong>. This permanently
            removes your account, saved items, macro targets, and subscription
            record from our systems. You can also email us at{" "}
            <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a> to request
            access, export, or deletion.
          </p>
          <p>
            Depending on where you live (for example, under GDPR or CCPA), you
            may have additional rights to access, correct, or restrict the
            processing of your data. We honor these requests regardless of your
            location.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Data retention</h2>
          <p>
            We keep your account data for as long as your account is active.
            When you delete your account, we delete the associated data
            promptly, except where we are required to retain limited records for
            legal or financial compliance.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Health disclaimer</h2>
          <div className={styles.callout}>
            <p>
              Macro estimates in Fitsy are AI-generated and approximate. They
              are intended as a planning guide, not medical or clinical
              nutrition advice. Always consult a registered dietitian or
              physician for health decisions.
            </p>
          </div>
        </section>

        <section className={styles.section}>
          <h2>Children</h2>
          <p>
            Fitsy is not directed to children under 13, and we do not knowingly
            collect personal information from them.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Changes to this policy</h2>
          <p>
            We may update this policy from time to time. When we do, we will
            revise the &ldquo;Last updated&rdquo; date above and, for material
            changes, notify you in the app.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Contact</h2>
          <p>
            Questions about your privacy? Email{" "}
            <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>.
          </p>
        </section>
      </article>
      <LegalFooter />
    </main>
  );
}
