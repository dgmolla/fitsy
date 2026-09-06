"use client";

import { useState } from "react";
import s from "@/app/landing-sections.module.css";
import { calcCalories } from "@/lib/seoUtils";
import { matchPct, matchTier, type Macros } from "@/lib/landingDemo";

/**
 * The two linked tiles of the feature grid: "Restaurant detail" (a menu ranked
 * by fit, after apps/mobile/app/restaurant/[id].tsx + MenuItemCard) and
 * "Tweak macros" (the FilterPopup stepper). Changing a target re-scores and
 * re-sorts the dishes with the app's own formula (lib/landingDemo.ts).
 * Rendered as a fragment so both tiles sit in the parent grid.
 */

/** Default per-meal targets shown in the app screenshots (49/73/18 → 650 kcal). */
const BASE_TARGET: Macros = { p: 49, c: 73, f: 18 };
const STEP_G = 5;
const MIN_G = 5;

const DISHES = [
  {
    name: "Tandoori Thali (Combo Dinner)",
    desc: "Chicken tandoori, tikka, veggie curry, naan, rice.",
    p: 45,
    c: 67,
    f: 16,
    kcal: 588,
    price: "$23.45",
  },
  {
    name: "Aloo Chana Bundle",
    desc: "Potatoes and chickpeas in chef's sauce",
    p: 14,
    c: 63,
    f: 18,
    kcal: 470,
    price: "$17.95",
  },
];

const STEPPER_ROWS: ReadonlyArray<[keyof Macros, string, string | undefined]> =
  [
    ["p", "Protein", s.dotP],
    ["c", "Carbs", s.dotC],
    ["f", "Fat", s.dotF],
  ];

export function MacroDemo() {
  const [target, setTarget] = useState<Macros>(BASE_TARGET);
  const kcal = calcCalories(target.p, target.c, target.f);
  const bump = (k: keyof Macros, d: number) =>
    setTarget((t) => ({ ...t, [k]: Math.max(MIN_G, t[k] + d) }));

  // "Ranked by fit": best match first, so the order changes as targets move.
  const ranked = DISHES.map((dish) => ({
    dish,
    pct: matchPct(dish, target),
  })).sort((a, b) => b.pct - a.pct);

  return (
    <>
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
              128 items<span>·</span>0.6 mi<span>·</span>Open<span>·</span>★ 4.5
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
            {ranked.map(({ dish: d, pct }, i) => {
              const tier = matchTier(pct);
              const tierClass =
                tier === "high" ? "" : tier === "mid" ? s.mid : s.low;
              return (
                <div className={s.fItem} key={d.name}>
                  <div className={`${s.fPct} ${tierClass}`}>{pct}%</div>
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

      <div className={s.tile}>
        <span className={s.eyebrow}>Tweak macros</span>
        <h3 className={s.tileTitle}>
          Change a number. Results re-rank <em>instantly.</em>
        </h3>
        <div className={s.tileBody}>
          <div className={`${s.frag} ${s.fPopup}`}>
            <div className={s.fPopupTitle}>Per-meal targets</div>
            {STEPPER_ROWS.map(([k, label, dotClass]) => (
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
                    onClick={() => bump(k, -STEP_G)}
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
                    onClick={() => bump(k, STEP_G)}
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
    </>
  );
}
