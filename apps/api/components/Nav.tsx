"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import styles from "./Nav.module.css";

interface NavLink {
  href: string;
  label: string;
}

interface NavProps {
  /** Extra links listed at the top of the hamburger menu (e.g. landing page sections). */
  links?: NavLink[];
}

/**
 * Shared site nav. Used by the landing page, restaurant listing, restaurant
 * detail, item detail, and legal pages so the brand bar reads identically
 * across the web app. The bar holds the wordmark and a single hamburger (all
 * viewports); every link lives in the dropdown so the bar itself stays clean.
 */
export function Nav({ links = [] }: NavProps = {}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const onHome = pathname === "/";
  const onDirectory = pathname === "/restaurants";

  return (
    <nav className={styles.nav}>
      <div className={styles.navInner}>
        <a href="/" className={styles.logo} onClick={() => setOpen(false)}>
          fitsy<span className={styles.logoDot}>.</span>
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
            {!onHome && (
              <a
                href="/"
                className={styles.menuItem}
                role="menuitem"
                onClick={() => setOpen(false)}
              >
                Home
              </a>
            )}
            {!onDirectory && (
              <a
                href="/restaurants"
                className={styles.menuItem}
                role="menuitem"
                onClick={() => setOpen(false)}
              >
                Browse Restaurants
              </a>
            )}
          </div>
        </>
      )}
    </nav>
  );
}
