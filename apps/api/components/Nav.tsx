import styles from "./Nav.module.css";

const EARLY_ACCESS_URL = "https://testflight.apple.com/join/fitsy";

/**
 * Shared site nav. Used by the landing page, restaurant listing, restaurant
 * detail, and item detail pages so the brand bar reads identically across
 * the web app.
 */
export function Nav() {
  return (
    <nav className={styles.nav}>
      <div className={styles.navInner}>
        <a href="/" className={styles.logo}>
          fitsy<span className={styles.logoDot}>.</span>
        </a>
        <div className={styles.actions}>
          <a
            href="/restaurants"
            className={`${styles.cta} ${styles.ctaGhost}`}
          >
            Browse Restaurants
          </a>
          <a href={EARLY_ACCESS_URL} className={styles.cta}>
            Get Early Access
          </a>
        </div>
      </div>
    </nav>
  );
}

