import styles from "../app/legal.module.css";

/**
 * Shared footer for the legal / support pages. Cross-links the three
 * compliance pages (privacy, terms, support) that App Store review checks,
 * and back to the marketing site.
 */
export function LegalFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <nav className={styles.footerLinks}>
          <a href="/">Home</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="/support">Support</a>
        </nav>
        <span className={styles.footerCopy}>&copy; {new Date().getFullYear()} Fitsy</span>
      </div>
    </footer>
  );
}
