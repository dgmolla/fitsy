import s from "@/app/landing-sections.module.css";
import { SearchTile } from "./SearchTile";
import { MacroDemo } from "./MacroDemo";

/**
 * Six-tile feature grid for the landing page. Each tile is a mono eyebrow +
 * serif headline with a CSS-built slice of the real app UI bleeding off the
 * bottom (copy and layout mirror the mobile screens: search.tsx,
 * restaurant/[id].tsx, FilterPopup, welcome/goal.tsx, saved.tsx,
 * feedback-board.tsx).
 *
 * Server component. Only the two interactive tiles (SearchTile, MacroDemo)
 * ship client JS; goals, saved and feedback are static markup.
 */

const GOALS = [
  "Lose weight",
  "Build muscle",
  "Eat healthier",
  "Explore cuisines",
];
const SELECTED_GOAL = "Build muscle";
const ONBOARDING_STEPS = 18;
const ONBOARDING_DONE = 10;

const SAVED_MEALS: ReadonlyArray<[string, number, number, number, number]> = [
  ["Chicken Tinga Market Plate", 714, 48, 78, 23],
  ["Combo Plate Chicken 2 Sides", 671, 45, 70, 23],
  ["Burrito Mexicano", 632, 42, 69, 21],
];

/**
 * Illustrative board posts. Real posts are deliberately NOT rendered here:
 * the board is auth-gated in the app and users were never told their posts
 * would appear on the public marketing page. The tile is labelled as an
 * example and the neighborhood named is one the app does not cover yet.
 */
const EXAMPLE_POSTS = [
  {
    message:
      'Filter by "under $15" on the search page too, not just inside a restaurant.',
    votes: 42,
  },
  {
    message: "Show the ingredient breakdown behind each macro estimate.",
    votes: 31,
  },
  { message: "Expand to Pasadena next please.", votes: 27 },
];

export function FeatureGrid() {
  return (
    <section className={s.section} id="features">
      <div className={s.container}>
        <div className={s.sectionHead}>
          <span className={s.eyebrow}>The app</span>
          <h2 className={s.sectionTitle}>
            Everything you need
            <br />
            to eat out <em>on plan.</em>
          </h2>
          <p className={s.sectionLead}>
            Set your targets once. Fitsy re-ranks every menu near you so the
            best fit is always at the top.
          </p>
        </div>

        <div className={s.grid}>
          <SearchTile />
          <MacroDemo />

          {/* Goals */}
          <div className={s.tile}>
            <span className={s.eyebrow}>Goals</span>
            <h3 className={s.tileTitle}>
              Tell us your goal. We set the <em>targets.</em>
            </h3>
            <div className={s.tileBody}>
              <div className={s.frag}>
                <div className={s.fProgress} aria-hidden="true">
                  {Array.from({ length: ONBOARDING_STEPS }, (_, i) => (
                    <i
                      key={i}
                      className={i < ONBOARDING_DONE ? s.on : undefined}
                    />
                  ))}
                </div>
                <div className={s.fQ}>What&apos;s your goal?</div>
                {GOALS.map((g) => {
                  const on = g === SELECTED_GOAL;
                  return (
                    <div className={`${s.fOpt} ${on ? s.on : ""}`} key={g}>
                      {g}
                      <span className={s.tick}>{on ? "✓" : ""}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Saved */}
          <div className={s.tile}>
            <span className={s.eyebrow}>Saved</span>
            <h3 className={s.tileTitle}>
              Keep the meals you <em>love.</em>
            </h3>
            <div className={s.tileBody}>
              <div className={s.frag}>
                <div className={s.fSavedHero}>
                  <div className={s.top}>
                    <span className={s.n}>{SAVED_MEALS.length + 1}</span>
                    <span className={s.lbl}>
                      saved
                      <br />
                      meals
                    </span>
                  </div>
                  <div className={s.sub}>from 2 restaurants near you</div>
                </div>
                {SAVED_MEALS.map(([name, kcal, p, c, f]) => (
                  <div className={s.fSavedRow} key={name}>
                    <div>
                      <b>{name}</b>
                      <small>
                        {kcal} kcal · <span className={s.p}>P {p}g</span> ·{" "}
                        <span className={s.c}>C {c}g</span> ·{" "}
                        <span className={s.f}>F {f}g</span>
                      </small>
                    </div>
                    <span className={s.fBookmark} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Feedback */}
          <div className={s.tile}>
            <span className={s.eyebrow}>Feedback board · example</span>
            <h3 className={s.tileTitle}>
              You decide what we build <em>next.</em>
            </h3>
            <div className={s.tileBody}>
              <div className={s.frag}>
                <div className={s.fBoardHead}>
                  What should we build next? Upvote what matters to you.
                </div>
                {EXAMPLE_POSTS.map((post, i) => (
                  <div className={s.fPost} key={post.message}>
                    <div>
                      <p>{post.message}</p>
                      <small>Example post</small>
                    </div>
                    <span className={`${s.fVote} ${i === 0 ? s.on : ""}`}>
                      <i>▲</i>
                      {post.votes}
                    </span>
                  </div>
                ))}
                <div className={s.fCompose}>
                  <div className={s.fInput}>
                    <span className={s.ph}>What&apos;s on your mind?</span>
                  </div>
                  <span className={s.fSend}>Send</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
