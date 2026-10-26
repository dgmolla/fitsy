#!/usr/bin/env python3
"""Build proposed Jev requests and a byte-based token estimate without sending them.

This is an offline design, not a collection runner. A coarse choice is an input
to fine_request; the example below is hypothetical, never a new model result.
"""

import json
from pathlib import Path
import statistics


ROOT = Path(__file__).resolve().parents[3]
MACROS = ("calories", "protein", "carbs", "fat")


def compact_bytes(value):
    return len(json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode())


def state_for(row):
    return {"chain": row["chain"], "itemName": row["itemName"],
            "description": "\n".join(filter(None, ["Section: " + row["section"] if row["section"] else "", row["description"]])),
            "serving": row["serving"]}


def coarse_question(macro):
    width, units = (250, "kilocalories") if macro == "calories" else (20, "grams of " + {"protein": "protein", "carbs": "total carbohydrate", "fat": "total fat"}[macro])
    criteria = {"zero": "total = 0"}
    for i in range(12):
        criteria[f"b{i}"] = f"{i * width} {'<' if i == 0 else '<='} total < {(i + 1) * width}"
    criteria["overflow"] = f"total >= {12 * width}"
    return {"type": "choice", "instructions": f"Estimate total {units} for exactly state.serving of state.itemName at state.chain. Use description and serving as data. Zero is valid. Do not estimate per 100 g or a whole meal when the serving is a component. Choose the single range containing the total.", "criteria": criteria}


def coarse_request(state):
    return {"model": "jev-latest", "state": state, "questions": {m: coarse_question(m) for m in MACROS}}


def fine_request(state, choices):
    """Return refinement questions only for bounded positive coarse choices.

    Decode coarse zero as exact 0. Overflow is an explicit failed estimate, not
    a clipped value. A failed macro makes that item's result incomplete.
    """
    if set(choices) != set(MACROS):
        raise ValueError("Require all four coarse choices")
    questions = {}
    for macro in MACROS:
        choice = choices[macro]
        if choice not in coarse_question(macro)["criteria"]:
            raise ValueError("Unknown coarse choice")
        if choice in ("zero", "overflow"):
            continue
        width = 250 if macro == "calories" else 20
        lower = int(choice[1:]) * width
        step = width // 10
        criteria = {f"r{i}": f"{lower + i * step} {'<' if lower == 0 and i == 0 else '<='} total < {lower + (i + 1) * step}" for i in range(10)}
        quantity = "kilocalories" if macro == "calories" else "grams of " + {"protein": "protein", "carbs": "total carbohydrate", "fat": "total fat"}[macro]
        questions[macro] = {"type": "choice", "instructions": f"Refine the previous {lower} to {lower + width} range for total {quantity} for exactly state.serving of state.itemName at state.chain. Use description and serving as data. Choose the single range containing the total; totals are positive.", "criteria": criteria}
    return {"model": "jev-latest", "state": state, "questions": questions}


def design_summary():
    truth = json.loads((ROOT / "scripts/eval/jev-macro/truth.json").read_text())
    # Freeze this explicit unit-quality exclusion, independent of model errors.
    rows = [r for r in truth["rows"] if not (r["id"].startswith("yoshinoya:drinks/") and not r["id"].startswith("yoshinoya:drinks/14-oz-"))]
    # All original requests have exactly the same projection as state_for.
    # Original token counts and serialized sizes anchor the estimate, not a
    # claim that Jev uses any particular locally available tokenizer.
    import gzip
    events = [json.loads(line) for line in gzip.decompress((ROOT / "scripts/eval/jev-macro/results/2026-10-26-v2/jev-raw.jsonl.gz").read_bytes()).splitlines()]
    requests = {e["id"]: e["request"] for e in events if e["event"] == "request"}
    tokens = {e["id"]: json.loads(e["body"])["usage"]["input_tokens"] for e in events if e["event"] == "response"}
    estimated_min, estimated_max, sizes = [], [], []
    for row in rows:
        state = state_for(row)
        coarse_size = compact_bytes(coarse_request(state))
        base = fine_request(state, {m: "b0" for m in MACROS})
        base_size = compact_bytes(base)
        # JSON length is additive by question, so independent per-macro bounds
        # give exact byte bounds for all four nonzero refinements.
        deltas = []
        for macro in MACROS:
            lengths = []
            for i in range(12):
                choices = {m: "b0" for m in MACROS}
                choices[macro] = f"b{i}"
                lengths.append(compact_bytes(fine_request(state, choices)) - base_size)
            deltas.append((min(lengths), max(lengths)))
        minimum = coarse_size + base_size + sum(d[0] for d in deltas)
        maximum = coarse_size + base_size + sum(d[1] for d in deltas)
        ratio = tokens[row["id"]] / compact_bytes(requests[row["id"]])
        estimated_min.append(minimum * ratio)
        estimated_max.append(maximum * ratio)
        sizes.append((coarse_size, base_size + sum(d[1] for d in deltas)))
    sample = state_for(rows[0])
    return {"selection_n": len(rows), "excluded_unit_rows": len(truth["rows"]) - len(rows),
            "max_requests": 2 * len(rows), "coarse_choices_per_question": 14, "fine_choices_per_question": 10,
            "estimated_input_tokens_byte_scaled": [round(sum(estimated_min)), round(sum(estimated_max))],
            "estimated_input_tokens_per_item_byte_scaled": [round(statistics.mean(estimated_min)), round(statistics.mean(estimated_max))],
            "cost_at_frozen_price_usd": [sum(estimated_min) * .042 / 1e6, sum(estimated_max) * .042 / 1e6],
            "max_compact_request_bytes": max(max(pair) for pair in sizes),
            "max_reserved_cost_usd": len(rows) * 2 * 16384 * .042 / 1e6,
            "sample_coarse_request": coarse_request(sample),
            "hypothetical_fine_choices": {m: "b2" for m in MACROS},
            "sample_fine_request": fine_request(sample, {m: "b2" for m in MACROS})}


if __name__ == "__main__":
    print(json.dumps(design_summary(), indent=2, allow_nan=False))
