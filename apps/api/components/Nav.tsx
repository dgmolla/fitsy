"use client";

import { useState } from "react";
import styles from "./Nav.module.css";

const EARLY_ACCESS_URL = "https://testflight.apple.com/join/fitsy";

/**
 * Shared site nav. Used by the landing page, restaurant listing, restaurant
 * detail, and item detail pages so the brand bar reads identically across
 * the web app. A single hamburger menu (all viewports) keeps the bar clean —
 * the links live in a regular dropdown menu rather than inline buttons.
 */
export interface NavLink {
  href: string;
  label: string;
}

interface NavProps {
  /** Inline anchor links (desktop only; collapse into the hamburger on mobile). */
  links?: NavLink[];
  /** Solid pill CTA shown left of the hamburger. */
  cta?: NavLink;
}

export function Nav({ links = [], cta }: NavProps = {}) {
  const [open, setOpen] = useState(false);

  return (
    <nav className={styles.nav}>
      <div className={styles.navInner}>
        <a href="/" className={styles.logo} onClick={() => setOpen(false)}>
          fitsy<span className={styles.logoDot}>.</span>
        </a>

        <div className={styles.navRight}>
          {links.length > 0 && (
            <div className={styles.navLinks}>
              {links.map((l) => (
                <a key={l.href} href={l.href}>
                  {l.label}
                </a>
              ))}
            </div>
          )}
          {cta && (
            <a href={cta.href} className={styles.navCta}>
              {cta.label}
            </a>
          )}
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
                className={`${styles.menuItem} ${styles.menuItemMobileOnly}`}
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
            <a
              href={EARLY_ACCESS_URL}
              className={styles.menuItem}
              role="menuitem"
              onClick={() => setOpen(false)}
            >
              Get Early Access
            </a>
          </div>
        </>
      )}
    </nav>
  );
}
