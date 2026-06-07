import type { Metadata } from "next";
import styles from "../legal.module.css";
import { Nav } from "@/components/Nav";
import { LegalFooter } from "@/components/LegalFooter";

export const metadata: Metadata = {
  title: "Support — Fitsy",
  description: "Get help with Fitsy. Contact us and browse common questions.",
};

const SUPPORT_EMAIL = "support@fitsy.app";
const PRIVACY_EMAIL = "privacy@fitsy.app";

export default function SupportPage() {
  return (
    <main className={styles.page}>
      <Nav />
      <article className={styles.container}>
        <span className={styles.kicker}>Help</span>
        <h1 className={styles.title}>Support</h1>
        <p className={styles.updated}>We&rsquo;re a small team and read every message.</p>

        <p className={styles.lede}>
          Need a hand with Fitsy? The fastest way to reach us is email — we
          typically reply within two business days.
        </p>

        <div className={styles.callout}>
          <p>
            <strong>Email us:</strong>{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
            <br />
            Tell us your device model and iOS version so we can help faster.
          </p>
        </div>

        <section className={styles.section}>
          <h2>Frequently asked questions</h2>

          <h3>How does Fitsy estimate macros?</h3>
          <p>
            Fitsy reads restaurant menu descriptions and uses AI to estimate
            the calories, protein, carbs, and fat for each dish. Every estimate
            shows a confidence indicator so you know how reliable it is — verified
            menu data is marked high confidence, while estimates from a dish name
            alone are marked lower. Always treat the numbers as a planning guide,
            not exact figures.
          </p>

          <h3>Why don&rsquo;t I see restaurants near me?</h3>
          <p>
            Fitsy is in beta and currently covers the Los Angeles area. Make
            sure location permission is enabled in Settings so we can find spots
            near you. We&rsquo;re expanding to more cities — tell us where you
            want Fitsy next.
          </p>

          <h3>How do I manage or cancel my subscription?</h3>
          <p>
            Subscriptions are billed through your Apple ID. To manage or cancel,
            open the iOS <strong>Settings</strong> app, tap your name, then{" "}
            <strong>Subscriptions</strong>, and select Fitsy. Cancellation takes
            effect at the end of the current billing period.
          </p>

          <h3>How do I delete my account?</h3>
          <p>
            Open Fitsy and go to <strong>Profile &rarr; Delete account</strong>.
            This permanently removes your account, saved items, macro targets,
            and subscription record. This cannot be undone.
          </p>

          <h3>How do I join or leave the beta?</h3>
          <p>
            Fitsy&rsquo;s beta runs through TestFlight. If you received an
            invite, install Apple&rsquo;s TestFlight app and tap your invite
            link to join. To leave, delete Fitsy from TestFlight or email us.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Other links</h2>
          <ul>
            <li>
              <a href="/privacy">Privacy Policy</a> — what we collect and how to
              delete your data
            </li>
            <li>
              <a href="/terms">Terms of Service</a> — subscription and usage
              terms
            </li>
            <li>
              Privacy requests: <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>
            </li>
          </ul>
        </section>
      </article>
      <LegalFooter />
    </main>
  );
}
