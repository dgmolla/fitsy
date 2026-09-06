"use client";

import { useEffect, useState } from "react";
import s from "@/app/landing-sections.module.css";

/**
 * "Text search" tile. Types example queries one character at a time and swaps
 * the hero result, mirroring the search screen (apps/mobile/app/(tabs)/search.tsx).
 * Illustrative dishes and macros; not live data.
 */

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
] as const;

const CYCLE_MS = 4200;
const KEYSTROKE_MS = 90;
const SWAP_DELAY_MS = 350;

export function SearchTile() {
  const [idx, setIdx] = useState(0);
  const [shown, setShown] = useState(0);
  const [typed, setTyped] = useState<string>(DEFAULT_EXAMPLE.q);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const cycle = setInterval(
      () => setIdx((i) => (i + 1) % SEARCH_EXAMPLES.length),
      CYCLE_MS,
    );
    return () => clearInterval(cycle);
  }, []);

  useEffect(() => {
    // Only true on initial mount (and under StrictMode's replayed effect):
    // the default query is already fully typed, nothing to animate.
    if (idx === shown) return;
    const q = (SEARCH_EXAMPLES[idx] ?? DEFAULT_EXAMPLE).q;
    let n = 0;
    let swap: ReturnType<typeof setTimeout> | undefined;
    setTyped("");
    const iv = setInterval(() => {
      n += 1;
      setTyped(q.slice(0, n));
      if (n >= q.length) {
        clearInterval(iv);
        swap = setTimeout(() => setShown(idx), SWAP_DELAY_MS);
      }
    }, KEYSTROKE_MS);
    return () => {
      clearInterval(iv);
      if (swap) clearTimeout(swap);
    };
  }, [idx, shown]);

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
          <div className={s.fHero}>
            <img src={ex.img} alt="" className={s.fHeroImg} />
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
