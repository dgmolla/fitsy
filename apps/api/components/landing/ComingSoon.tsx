import s from "@/app/coming-soon.module.css";

/**
 * Replaced the email waitlist form (#764): no launch date to count down to
 * and no email capture, just a plain status. `align="center"` is for the
 * closing section; the hero is left-aligned.
 */
export function ComingSoon({ align = "start" }: { align?: "start" | "center" }) {
  const centered = align === "center";
  return (
    <div className={centered ? s.center : undefined}>
      <span className={s.badge}>
        <span aria-hidden="true">&#10003;</span>
        Coming soon
      </span>
      <p className={s.note}>iPhone, Los Angeles first.</p>
    </div>
  );
}
