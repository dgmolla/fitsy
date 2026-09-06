"use client";

import { useState } from "react";
import styles from "./Nav.module.css";
import { AppleIcon } from "./AppleIcon";

const EARLY_ACCESS_URL = "https://testflight.apple.com/join/fitsy";

export interface NavLink {
  href: string;
  label: string;
}

interface NavProps {
  /** Extra links listed at the top of the hamburger menu (e.g. landing page sections). */
  links?: NavLink[];
  /** Where the App Store badge points. Defaults to the early-access URL. */
  downloadHref?: string;
}

/**
 * Shared site nav. Used by the landing page, restaurant listing, restaurant
 * detail, item detail, and legal pages so the brand bar reads identically
 * across the web app. The bar holds the wordmark, an App Store badge, and a
 * single hamburger (all viewports); every link lives in the dropdown so the
 * bar itself stays clean.
 */
export function Nav({
  links = [],
  downloadHref = EARLY_ACCESS_URL,
}: NavProps = {}) {
  const [open, setOpen] = useState(false);

  return (
    <nav className={styles.nav}>
      <div className={styles.navInner}>
        <a href="/" className={styles.logo} onClick={() => setOpen(false)}>
          fitsy<span className={styles.logoDot}>.</span>
        </a>

        <div className={styles.navRight}>
          <a href={downloadHref} className={styles.storeBadge}>
            <AppleIcon size={18} />
            <span className={styles.storeBadgeText}>
              <small>Download on the</small>
              <b>App Store</b>
            </span>
          </a>

          <button
            type="button"
            className={`${styles.hamburger} ${open ? styles.hamburgerOpen : ""}`}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <span className={styles.hamburgerBar} />
            <span className={styles.hamburgerBar} />
            <span className={styles.hamburgerBar} />
          </button>
        </div>
      </div>

      {open && (
        <>
          <button
            type="button"
            className={styles.menuBackdrop}
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOpen(false)}
          />
          <div className={styles.menuPanel} role="menu">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className={styles.menuItem}
                role="menuitem"
                onClick={() => setOpen(false)}
              >
                {l.label}
              </a>
            ))}
            <a
              href="/restaurants"
              className={styles.menuItem}
              role="menuitem"
              onClick={() => setOpen(false)}
            >
              Browse Restaurants
            </a>
          </div>
        </>
      )}
    </nav>
  );
}
