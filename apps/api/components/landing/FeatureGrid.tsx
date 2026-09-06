"use client";

import { useEffect, useRef, useState } from "react";
import s from "@/app/landing-sections.module.css";

/**
 * Six-tile feature grid for the landing page. Each tile is a mono eyebrow +
 * serif headline with a CSS-built slice of the real app UI bleeding off the
 * bottom (copy and layout mirror the mobile screens: search.tsx,
 * restaurant/[id].tsx, FilterPopup, welcome/goal.tsx, saved.tsx,
 * feedback-board.tsx).
 *
 * Two tiles are live: the search tile cycles example queries, and the macro
 * stepper recomputes the per-meal kcal (4/4/9) and re-ranks (re-sorts) the two
 * dishes in the restaurant-detail tile. Everything else is static markup.
 */

interface FeedbackTilePost {
  message: string;
  displayName: string;
  voteCount: number;
}

const DEFAULT_EXAMPLE = {
  q: "noodles",
  img: "/landing/dish-09.jpg",
  name: "Gingergrass",
  dish: "Grilled Pork Noodle Bowl",
  p: 38,
  c: 67,
  f: 18,
  kcal: 584,
  second: "Orange Door Sushi",
};

const SEARCH_EXAMPLES = [
  DEFAULT_EXAMPLE,
  {
    q: "salmon",
    img: "/landing/dish-04.jpg",
    name: "Pine and Crane",
    dish: "Miso Salmon Rice Bowl",
    p: 41,
    c: 58,
    f: 17,
    kcal: 549,
    second: "Sushi Gen",
  },
  {
    q: "tacos",
    img: "/landing/dish-01.jpg",
    name: "Guisados",
    dish: "Chicken Tinga Plate",
    p: 46,
    c: 71,
    f: 19,
    kcal: 639,
    second: "Sonoratown",
  },
  {
    q: "dumplings",
    img: "/landing/dish-11.jpg",
    name: "Pine and Crane",
    dish: "Shrimp Dumplings (8)",
    p: 34,
    c: 62,
    f: 14,
    kcal: 510,
    second: "Din Tai Fung",
  },
];

/** Default per-meal targets shown in the app screenshots (49/73/18 → 650 kcal). */
const BASE_TARGET = { p: 49, c: 73, f: 18 };
const DETAIL_DISHES = [
  {
    name: "Tandoori Thali (Combo Dinner)",
    desc: "Chicken tandoori, tikka, veggie curry, naan, rice.",
    p: 45,
    c: 67,
    f: 16,
    kcal: 588,
    price: "$23.45",
    basePct: 91,
  },
  {
    name: "Aloo Chana Bundle",
    desc: "Potatoes and chickpeas in chef's sauce",
    p: 14,
    c: 63,
    f: 18,
    kcal: 470,
    price: "$17.95",
    basePct: 72,
  },
];

type Macros = { p: number; c: number; f: number };

function relErr(d: Macros, t: Macros): number {
  return (
    Math.abs(d.p - t.p) / t.p +
    Math.abs(d.c - t.c) / t.c +
    Math.abs(d.f - t.f) / t.f
  );
}

/** Match % anchored to the screenshot values at the default target, then moved by the change in relative error. */
function matchPct(
  dish: (typeof DETAIL_DISHES)[number],
  target: Macros,
): number {
  const delta = relErr(dish, target) - relErr(dish, BASE_TARGET);
  return Math.max(20, Math.min(100, Math.round(dish.basePct - delta * 45)));
}

/**
 * Illustrative board posts. Real posts are deliberately NOT rendered here:
 * the board is auth-gated in the app and users were never told their posts
 * would appear on the public marketing page.
 */
const EXAMPLE_POSTS: FeedbackTilePost[] = [
  {
    message:
      'Filter by "under $15" on the search page too, not just inside a restaurant.',
    displayName: "Beta tester",
    voteCount: 42,
  },
  {
    message: "Show the ingredient breakdown behind each macro estimate.",
    displayName: "Beta tester",
    voteCount: 31,
  },
  {
    message: "Expand to Koreatown next please.",
    displayName: "Beta tester",
    voteCount: 27,
  },
];

export function FeatureGrid() {
  const [target, setTarget] = useState<Macros>(BASE_TARGET);
  const kcal = target.p * 4 + target.c * 4 + target.f * 9;
  const bump = (k: keyof Macros, d: number) =>
    setTarget((t) => ({ ...t, [k]: Math.max(5, t[k] + d) }));
  // "Ranked by fit": best match first, so the order changes as targets move.
  const rankedDishes = DETAIL_DISHES.map((dish) => ({
    dish,
    pct: matchPct(dish, target),
  })).sort((a, b) => b.pct - a.pct);

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

          {/* Restaurant detail */}
          <div className={s.tile}>
            <span className={s.eyebrow}>Restaurant detail</span>
            <h3 className={s.tileTitle}>
              Every dish on the menu, <em>ranked by fit.</em>
            </h3>
            <div className={s.tileBody}>
              <div className={s.frag}>
                <div className={s.fTitle}>
                  The Indian <em>Kitchen</em>
                </div>
                <div className={s.fMeta}>
                  128 items<span>·</span>0.6 mi<span>·</span>Open<span>·</span>★
                  4.5
                </div>
                <div className={s.fChips}>
                  <span className={`${s.fChip} ${s.on}`}>High protein</span>
                  <span className={s.fChip}>Under 700 cal</span>
                  <span className={s.fChip}>Vegan</span>
                  <span className={s.fChip}>Gluten free</span>
                </div>
                <div className={s.fSortBar}>
                  <div>
                    <b>41 dishes match</b>
                    <small>filtered from 128 · sorted by match</small>
                  </div>
                  <span className={s.btn}>Sort ↓</span>
                </div>
                {rankedDishes.map(({ dish: d, pct }, i) => {
                  const tier = pct >= 85 ? "" : pct >= 55 ? s.mid : s.low;
                  return (
                    <div className={s.fItem} key={d.name}>
                      <div className={`${s.fPct} ${tier}`}>{pct}%</div>
                      <div>
                        <div className={s.fName}>{d.name}</div>
                        <div className={s.fDesc}>{d.desc}</div>
                        <div className={s.fMacros}>
                          <span className={s.p}>
                            {d.p}
                            <i>p</i>
                          </span>
                          <span className={s.c}>
                            {d.c}
                            <i>c</i>
                          </span>
                          <span className={s.f}>
                            {d.f}
                            <i>f</i>
                          </span>
                          <span className={s.k}>
                            {d.kcal}
                            <i>cal</i>
                          </span>
                        </div>
                        {i === 0 && <span className={s.fTop}>TOP PICK</span>}
                      </div>
                      <div className={s.fPrice}>{d.price}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Tweak macros */}
          <div className={s.tile}>
            <span className={s.eyebrow}>Tweak macros</span>
            <h3 className={s.tileTitle}>
              Change a number. Results re-rank <em>instantly.</em>
            </h3>
            <div className={s.tileBody}>
              <div className={`${s.frag} ${s.fPopup}`}>
                <div className={s.fPopupTitle}>Per-meal targets</div>
                {(
                  [
                    ["p", "Protein", s.dotP],
                    ["c", "Carbs", s.dotC],
                    ["f", "Fat", s.dotF],
                  ] as const
                ).map(([k, label, dotClass]) => (
                  <div className={s.fStep} key={k}>
                    <div className={s.lbl}>
                      <span className={`${s.dot} ${dotClass}`} />
                      {label}
                    </div>
                    <div className={s.ctrl}>
                      <button
                        type="button"
                        className={s.btn}
                        aria-label={`Decrease ${label}`}
                        onClick={() => bump(k, -5)}
                      >
                        −
                      </button>
                      <span className={s.val}>
                        {target[k]}
                        <small>g</small>
                      </span>
                      <button
                        type="button"
                        className={s.btn}
                        aria-label={`Increase ${label}`}
                        onClick={() => bump(k, 5)}
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
                <div className={s.fTotal}>
                  <span className={s.fTotalLabel}>Per meal</span>
                  <b>
                    {kcal}
                    <small>kcal</small>
                  </b>
                </div>
                <div className={s.fApply}>Apply</div>
              </div>
            </div>
          </div>

          {/* Goals */}
          <div className={s.tile}>
            <span className={s.eyebrow}>Goals</span>
            <h3 className={s.tileTitle}>
              Tell us your goal. We set the <em>targets.</em>
            </h3>
            <div className={s.tileBody}>
              <div className={s.frag}>
                <div className={s.fProgress} aria-hidden="true">
                  {Array.from({ length: 18 }, (_, i) => (
                    <i key={i} className={i < 10 ? s.on : undefined} />
                  ))}
                </div>
                <div className={s.fQ}>What&apos;s your goal?</div>
                {[
                  "Lose weight",
                  "Build muscle",
                  "Eat healthier",
                  "Explore cuisines",
                ].map((g) => {
                  const on = g === "Build muscle";
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
                    <span className={s.n}>4</span>
                    <span className={s.lbl}>
                      saved
                      <br />
                      meals
                    </span>
                  </div>
                  <div className={s.sub}>from 2 restaurants near you</div>
                </div>
                {[
                  ["Chicken Tinga Market Plate", 714, 48, 78, 23],
                  ["Combo Plate Chicken 2 Sides", 671, 45, 70, 23],
                  ["Burrito Mexicano", 632, 42, 69, 21],
                ].map(([name, kcal, p, c, f]) => (
                  <div className={s.fSavedRow} key={name as string}>
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
            <span className={s.eyebrow}>Feedback</span>
            <h3 className={s.tileTitle}>
              You decide what we build <em>next.</em>
            </h3>
            <div className={s.tileBody}>
              <div className={s.frag}>
                <div className={s.fBoardHead}>
                  What should we build next? Upvote what matters to you.
                </div>
                {EXAMPLE_POSTS.map((post, i) => (
                  <div className={s.fPost} key={`${post.displayName}-${i}`}>
                    <div>
                      <p>{post.message}</p>
                      <small>— {post.displayName}</small>
                    </div>
                    <span className={`${s.fVote} ${i === 0 ? s.on : ""}`}>
                      <i>▲</i>
                      {post.voteCount}
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

/** Search tile: types example queries one character at a time and swaps the hero result. */
function SearchTile() {
  const [idx, setIdx] = useState(0);
  const [typed, setTyped] = useState(DEFAULT_EXAMPLE.q);
  const [shown, setShown] = useState(0);
  const mounted = useRef(false);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const cycle = setInterval(
      () => setIdx((i) => (i + 1) % SEARCH_EXAMPLES.length),
      4200,
    );
    return () => clearInterval(cycle);
  }, []);

  useEffect(() => {
    // Skip the initial render: the default query is already fully typed.
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const q = (SEARCH_EXAMPLES[idx] ?? DEFAULT_EXAMPLE).q;
    let n = 0;
    let swap: ReturnType<typeof setTimeout> | undefined;
    setTyped("");
    const iv = setInterval(() => {
      n += 1;
      setTyped(q.slice(0, n));
      if (n >= q.length) {
        clearInterval(iv);
        swap = setTimeout(() => setShown(idx), 350);
      }
    }, 90);
    return () => {
      clearInterval(iv);
      if (swap) clearTimeout(swap);
    };
  }, [idx]);

  const ex = SEARCH_EXAMPLES[shown] ?? DEFAULT_EXAMPLE;
  return (
    <div className={s.tile}>
      <span className={s.eyebrow}>Text search</span>
      <h3 className={s.tileTitle}>
        Type a dish. Get every match <em>nearby.</em>
      </h3>
      <div className={s.tileBody}>
        <div className={s.frag}>
          <div className={s.fInput}>
            <span className={s.glyph}>⌕</span>
            <span>{typed}</span>
            <span className={s.caret} />
            <span className={s.x}>×</span>
          </div>
          <div
            className={s.fHero}
            style={{ backgroundImage: `url(${ex.img})` }}
          >
            <div className={s.fHeroMeta}>
              <span>01</span>
              <span>DF</span>
              <span>GF</span>
              <span className={s.dist}>1.5 mi</span>
            </div>
            <div className={s.fHeroName}>{ex.name}</div>
            <div className={s.fHeroDish}>{ex.dish}</div>
            <div className={s.fHeroMacros}>
              P {ex.p}g · C {ex.c}g · F {ex.f}g · <b>{ex.kcal} kcal</b>
            </div>
          </div>
          <div className={s.fRow}>
            <span className={s.fIdx}>02</span>
            <div>
              <b>{ex.second}</b>
              <small>0.6 mi · ★4.5</small>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
