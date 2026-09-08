"use client";

import { useId, useState, type FormEvent } from "react";
import s from "@/app/waitlist-form.module.css";
import { joinWaitlist } from "@/lib/waitlistClient";
import { LAUNCH_CITY, LAUNCH_DATE_LABEL } from "@/lib/launch";

/**
 * Email capture for the launch waitlist. Posts to /api/waitlist/web, which
 * writes to the same LaunchWaitlist table as the app's "Notify me at launch"
 * screen, so the website and onboarding feed one list.
 *
 * `align="center"` is for the closing section; the hero is left-aligned.
 */
export function WaitlistForm({
  align = "start",
  autoFocus = false,
}: {
  align?: "start" | "center";
  autoFocus?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [status, setStatus] = useState<"idle" | "submitting" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status !== "idle") return;
    setStatus("submitting");
    setError(null);
    const result = await joinWaitlist(email, website);
    if (result.ok) {
      setStatus("done");
    } else {
      setError(result.error);
      setStatus("idle");
    }
  }

  const cls = align === "center" ? `${s.form} ${s.center}` : s.form;

  if (status === "done") {
    return (
      <div className={cls} role="status" aria-live="polite">
        <span className={s.done}>
          <span className={s.doneIcon} aria-hidden="true">
            &#10003;
          </span>
          You&rsquo;re on the list. We&rsquo;ll email you at launch.
        </span>
      </div>
    );
  }

  return (
    <form className={cls} onSubmit={onSubmit} noValidate>
      <div className={s.row}>
        <label htmlFor={inputId} className={s.hp}>
          Email
        </label>
        <input
          id={inputId}
          className={s.input}
          type="email"
          name="email"
          inputMode="email"
          autoComplete="email"
          autoFocus={autoFocus}
          placeholder="you@example.com"
          required
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
        />
        <button
          type="submit"
          className={s.button}
          disabled={status === "submitting" || email.trim().length === 0}
        >
          {status === "submitting" ? "Joining…" : "Join the waitlist"}
        </button>
      </div>
      {/* Honeypot: hidden from people, filled by bots. Server drops entries that set it. */}
      <input
        className={s.hp}
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
      />
      {error ? (
        <p id={`${inputId}-error`} className={s.error} role="alert">
          {error}
        </p>
      ) : (
        <p className={s.note}>
          {LAUNCH_CITY} launches {LAUNCH_DATE_LABEL}. We&rsquo;ll email you the
          moment Fitsy opens in your city. No spam, unsubscribe anytime.
        </p>
      )}
    </form>
  );
}
