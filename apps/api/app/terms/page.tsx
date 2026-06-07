import type { Metadata } from "next";
import styles from "../legal.module.css";
import { Nav } from "@/components/Nav";
import { LegalFooter } from "@/components/LegalFooter";

export const metadata: Metadata = {
  title: "Terms of Service — Fitsy",
  description:
    "The terms that govern your use of Fitsy, including subscription terms.",
};

const SUPPORT_EMAIL = "support@fitsy.app";
const EFFECTIVE_DATE = "June 6, 2026";

export default function TermsPage() {
  return (
    <main className={styles.page}>
      <Nav />
      <article className={styles.container}>
        <span className={styles.kicker}>Legal</span>
        <h1 className={styles.title}>Terms of Service</h1>
        <p className={styles.updated}>Last updated {EFFECTIVE_DATE}</p>

        <p className={styles.lede}>
          These terms govern your use of the Fitsy app and website. By creating
          an account or using Fitsy, you agree to them. Please read them
          alongside our{" "}
          <a href="/privacy" style={{ color: "var(--green-accent)" }}>
            Privacy Policy
          </a>
          .
        </p>

        <section className={styles.section}>
          <h2>Using Fitsy</h2>
          <p>
            Fitsy helps you discover restaurants with meals that fit your macro
            targets. You must be at least 13 years old to use Fitsy. You are
            responsible for keeping your account secure and for activity that
            happens under it.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Subscriptions and billing</h2>
          <p>
            Fitsy is a paid subscription app offered through an auto-renewing
            subscription. Both plans include a free trial; after the trial,
            your subscription begins unless you cancel beforehand.
          </p>
          <ul>
            <li>
              Payment is charged to your Apple ID account at confirmation of
              purchase.
            </li>
            <li>
              Your subscription automatically renews at the end of each period
              unless you turn off auto-renew at least 24 hours before the period
              ends.
            </li>
            <li>
              Your account is charged for renewal within 24 hours before the
              end of the current period, at the price of your selected plan.
            </li>
            <li>
              You can manage or cancel your subscription in your Apple ID
              account settings after purchase.
            </li>
            <li>
              Any unused portion of a free trial is forfeited when you purchase
              a subscription.
            </li>
          </ul>
          <p>
            Subscriptions are sold through Apple&rsquo;s In-App Purchase system
            and are subject to{" "}
            <a href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/">
              Apple&rsquo;s Standard End User License Agreement (EULA)
            </a>
            .
          </p>
        </section>

        <section className={styles.section}>
          <h2>Nutrition data and disclaimer</h2>
          <div className={styles.callout}>
            <p>
              Macro and calorie estimates in Fitsy are AI-generated from menu
              descriptions and are approximate. Each estimate carries a
              confidence indicator. Fitsy is a planning tool, not a source of
              medical or clinical nutrition advice. Do not rely on it for
              medical decisions; consult a registered dietitian or physician.
              Fitsy is not liable for decisions made based on estimated data.
            </p>
          </div>
        </section>

        <section className={styles.section}>
          <h2>Acceptable use</h2>
          <p>You agree not to:</p>
          <ul>
            <li>Reverse engineer, scrape, or resell the app or its data.</li>
            <li>Use Fitsy to violate any law or third party&rsquo;s rights.</li>
            <li>
              Interfere with or disrupt the integrity or performance of the
              service.
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>Intellectual property</h2>
          <p>
            Fitsy and its content, branding, and software are owned by Fitsy and
            protected by intellectual property laws. We grant you a limited,
            non-exclusive, non-transferable license to use the app for personal,
            non-commercial purposes.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Termination</h2>
          <p>
            You may stop using Fitsy and delete your account at any time from{" "}
            <strong>Profile &rarr; Delete account</strong>. We may suspend or
            terminate access if you violate these terms.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Disclaimers and limitation of liability</h2>
          <p>
            Fitsy is provided &ldquo;as is&rdquo; without warranties of any
            kind. To the maximum extent permitted by law, Fitsy is not liable
            for any indirect, incidental, or consequential damages arising from
            your use of the app.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Changes to these terms</h2>
          <p>
            We may update these terms from time to time. When we make material
            changes, we will update the date above and notify you in the app.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Contact</h2>
          <p>
            Questions about these terms? Email{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
          </p>
        </section>
      </article>
      <LegalFooter />
    </main>
  );
}
