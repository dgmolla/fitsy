#!/usr/bin/env python3
"""Recompute the 2026-10-26 audit using local, explicitly named evidence only.

Standard library only. No environment reads, model imports, network or database.
Print JSON to stdout, or use --out with a new file (normally under /tmp).
"""

import argparse
import collections
import gzip
import hashlib
import itertools
import json
import math
from pathlib import Path
import re
import statistics
import unicodedata


ROOT = Path(__file__).resolve().parents[3]
MACROS = ("calories", "protein", "carbs", "fat")
TRUTH_FIELDS = ("calories", "protein_g", "carbs_g", "fat_g")
OLD_FIELDS = ("calories", "proteinG", "carbsG", "fatG")
MACRO_DIR = Path("scripts/eval/jev-macro/results/2026-10-26-v2")
CHAIN_JOURNAL = Path("scripts/eval/results/jev-chain-match-2026-10-26/jev-raw.jsonl")
APRIL = (
    "20260405-000337-haiku-baseline.json",
    "20260405-000551-haiku-chain-hints.json",
    "20260405-000601-haiku-serving.json",
)
SPOT_IDS = (
    "waba-grill:chicken-bowl",
    "waba-grill:family-a-la-carte/white-rice-2-servings",
    "waba-grill:family-a-la-carte/wm-chicken",
    "waba-grill:tacos/chicken",
    "waba-grill:sides/shrimp-4-pc",
    "waba-grill:sauce-dressing/waba-hot-sauce-packet",
    "waba-grill:packaged/poppi/raspberry-rose/12-fl-oz",
    "waba-grill:packaged/pepsi/original/20-fl-oz",
    "yoshinoya:regular-bowls-on-white-rice-w-mixed-veggies/gyudon-beef-w-o-veg",
    "yoshinoya:large-bowls-on-white-rice-w-mixed-veggies/tfc-large-blended-sauce",
    "yoshinoya:regular-combo-bowls-select-one-base/white-rice",
    "yoshinoya:sides/teriyaki-ribeye",
    "yoshinoya:drinks/aquafina-bottled-water",
    "yoshinoya:drinks/brisk-raspberry-sweetened-iced-tea-regular",
    "yoshinoya:packets/gyoza-sauce-2-packs",
)


def load(path):
    return json.loads((ROOT / path).read_text())


def digest(data):
    return hashlib.sha256(data).hexdigest()


def med(values):
    return statistics.median(values) if values else None


def ape(estimate, truth):
    # Retain April's convention, including strictly >50% for catastrophes.
    return abs(estimate - truth) / truth * 100 if truth else (100.0 if estimate > 0 else 0.0)


def normalize(value):
    value = value.replace("®", "").replace("™", "").replace("&", " and ")
    value = value.replace("'", "").replace("’", "")
    value = unicodedata.normalize("NFKD", value.casefold())
    value = "".join(c for c in value if not unicodedata.combining(c))
    return " ".join(re.sub(r"[^a-z0-9]+", " ", value).split())


def identity(row):
    return normalize(row["chain"]), normalize(row["name"])


def score(rows, estimates):
    if len(rows) != len(estimates):
        raise ValueError("Estimate/truth length mismatch")
    if not rows:
        return None
    by_macro = {}
    for macro in MACROS:
        pairs = [(e[macro], r["truth"][macro]) for r, e in zip(rows, estimates)]
        nonzero = [(e, t) for e, t in pairs if t > 0]
        by_macro[macro] = {
            "mdape": med([ape(e, t) for e, t in pairs]),
            "mae": statistics.mean(abs(e - t) for e, t in pairs),
            "mean_signed_units": statistics.mean(e - t for e, t in pairs),
            "median_signed_pct_nonzero_truth": med([(e - t) / t * 100 for e, t in nonzero]),
            "over": sum(e > t for e, t in pairs),
            "under": sum(e < t for e, t in pairs),
            "equal": sum(e == t for e, t in pairs),
            "zero_truth": sum(t == 0 for _, t in pairs),
        }
    catastrophic = sum(ape(e["calories"], r["truth"]["calories"]) > 50 for r, e in zip(rows, estimates))
    return {"n": len(rows), "by_macro": by_macro, "catastrophic": catastrophic,
            "catastrophic_rate": catastrophic / len(rows)}


def compare(left, right):
    """Match full normalized names, exclude ambiguous keys, then require equal truth.

    Serving/size words are never removed. Do not turn repeated names into a
    Cartesian join or compare different nutrition truths as paired observations.
    """
    indexes = []
    for rows in (left, right):
        index = collections.defaultdict(list)
        for row in rows:
            index[identity(row)].append(row)
        indexes.append(index)
    common = sorted(indexes[0].keys() & indexes[1].keys())
    pairs, ambiguous, unequal_truth = [], [], []
    for key in common:
        a, b = indexes[0][key], indexes[1][key]
        if len(a) != 1 or len(b) != 1:
            ambiguous.append(key)
        elif a[0]["truth"] != b[0]["truth"]:
            unequal_truth.append(key)
        else:
            pairs.append((a[0], b[0]))
    return {
        "name_overlap": len(common), "paired_n": len(pairs),
        "ambiguous": ambiguous, "unequal_truth": unequal_truth,
        "keys": [identity(a) for a, _ in pairs],
        "left": score([a for a, _ in pairs], [a["estimate"] for a, _ in pairs]),
        "right": score([b for _, b in pairs], [b["estimate"] for _, b in pairs]),
    }


def representative(label):
    parts = label.split("_")
    return float(parts[1]) + (25 if parts[0] == "kcal" else 2) if parts[-1] == "plus" else (float(parts[1]) + float(parts[2])) / 2


def oracle_bin(truth, macro):
    width, upper = (25, 2500) if macro == "calories" else (2, 200)
    return upper + width if truth >= upper else math.floor(truth / width) * width + width / 2


def category(row):
    key = row["id"].split(":", 1)[1].split("/", 1)[0]
    if key in ("drinks", "packaged"):
        return "drinks"
    if key in ("sauce-dressing", "side-sauces", "packets"):
        return "sauces"
    if key == "family-a-la-carte":
        return "family-a-la-carte"
    if key == "desserts":
        return "desserts"
    if "select-" in key or key in ("sides", "appetizers", "miso-soup", "blount-clam-chowder", "gyudon-beef-side", "habanero-chicken-side"):
        return "sides/components"
    return "entrees"


def journal(path):
    data = gzip.decompress(path.read_bytes()) if path.suffix == ".gz" else path.read_bytes()
    events = [json.loads(line) for line in data.splitlines()]
    assert events[0]["event"] == "start" and events[-1] == {"event": "end", "stopReason": None}
    return data, events


def alternating(events, ids):
    assert len(events) == 2 * len(ids) + 2, "Incomplete or extra journal events"
    for i, identifier in enumerate(ids):
        request, response = events[2 * i + 1:2 * i + 3]
        assert request["event"] == "request" and response["event"] == "response"
        assert request["id"] == response["id"] == identifier
        assert response["status"] == 200
        yield request, json.loads(response["body"]), response["latencyMs"]


def validate_answer(answer, names):
    probabilities = answer["probabilities"]
    assert answer["type"] == "choice" and set(probabilities) == set(names)
    assert all(math.isfinite(p) and 0 <= p <= 1 for p in probabilities.values())
    assert 0 <= answer["confidence"] <= 1
    assert abs(sum(probabilities.values()) - 1) <= 0.010000000001
    assert probabilities[answer["choice"]] == max(probabilities.values())


def macro_audit(path):
    frozen = load("scripts/eval/jev-macro/truth.json")
    archived = load(MACRO_DIR / "summary.json")
    data, events = journal(path)
    assert digest((ROOT / "scripts/eval/jev-macro/truth.json").read_bytes()) == events[0]["truthSha256"]
    assert events[0]["protocolSha256"] == archived["protocolSha256"]
    assert events[0]["protocol"] == archived["protocol"]
    rows, distributions, usage, latencies = [], {m: [] for m in MACROS}, [], []
    estimates = {"expected_value": [], "argmax": [], "true_bin_midpoint": []}
    for item, (request, response, latency) in zip(frozen["rows"], alternating(events, [r["id"] for r in frozen["rows"]])):
        expected_state = {"chain": item["chain"], "itemName": item["itemName"],
                          "description": "\n".join(filter(None, ["Section: " + item["section"] if item["section"] else "", item["description"]])),
                          "serving": item["serving"]}
        assert request["request"] == {"model": "jev-latest", "questions": archived["protocol"]["questions"], "state": expected_state}
        assert set(response["answers"]) == set(MACROS)
        assert response["model"] == "jev-1.14.0"
        row = {"id": item["id"], "chain": item["chain"], "name": item["itemName"], "serving": item["serving"],
               "truth": dict(zip(MACROS, [item[k] for k in TRUTH_FIELDS])), "category": category(item)}
        rows.append(row)
        decoded, argmax, oracle = {}, {}, {}
        for macro in MACROS:
            answer = response["answers"][macro]
            validate_answer(answer, archived["protocol"]["questions"][macro]["criteria"])
            raw = answer["probabilities"]
            total = sum(raw.values())
            probabilities = {k: v / total for k, v in raw.items()}
            decoded[macro] = sum(p * representative(k) for k, p in probabilities.items())
            argmax[macro] = representative(answer["choice"])
            oracle[macro] = oracle_bin(row["truth"][macro], macro)
            entropy = -sum(p * math.log2(p) for p in probabilities.values() if p)
            distributions[macro].append({"entropy_bits": entropy, "normalized_entropy": entropy / math.log2(len(raw)),
                                         "effective_bins": 2 ** entropy, "peak": max(probabilities.values()),
                                         "nonzero_bins": sum(p > 0 for p in probabilities.values()), "confidence": answer["confidence"],
                                         "mean_minus_argmax": decoded[macro] - argmax[macro],
                                         "open_top_mass": probabilities["kcal_2500_plus" if macro == "calories" else "g_200_plus"]})
        for method, values in (("expected_value", decoded), ("argmax", argmax), ("true_bin_midpoint", oracle)):
            estimates[method].append(values)
        saved = archived["results"][len(rows) - 1]
        assert saved["id"] == row["id"] and saved["failure"] is None
        assert all(math.isclose(decoded[m], saved["estimate"][m], abs_tol=1e-8) for m in MACROS)
        usage.append(response["usage"])
        latencies.append(latency)
    metrics = {method: score(rows, values) for method, values in estimates.items()}
    for macro in MACROS:
        assert math.isclose(metrics["expected_value"]["by_macro"][macro]["mdape"], archived["metrics"]["medianAbsolutePctError"][macro], abs_tol=1e-8)
    assert metrics["expected_value"]["catastrophic"] == archived["metrics"]["catastrophicMisses"]
    group_scores = {}
    for name in sorted({r["category"] for r in rows}):
        indices = [i for i, r in enumerate(rows) if r["category"] == name]
        group_scores[name] = {method: score([rows[i] for i in indices], [values[i] for i in indices]) for method, values in estimates.items()}
    suspicious = [r["id"] for r in frozen["rows"] if r["id"].startswith("yoshinoya:drinks/") and "published mass" in r["serving"] and not r["id"].startswith("yoshinoya:drinks/14-oz-")]
    subsets = {
        "truth_fat_at_least_2g": [i for i, r in enumerate(rows) if r["truth"]["fat"] >= 2],
        "truth_fat_below_2g": [i for i, r in enumerate(rows) if r["truth"]["fat"] < 2],
        "truth_calories_at_least_150": [i for i, r in enumerate(rows) if r["truth"]["calories"] >= 150],
        "exclude_suspect_drink_units": [i for i, r in enumerate(rows) if r["id"] not in suspicious],
        "entrees_and_family": [i for i, r in enumerate(rows) if r["category"] in ("entrees", "family-a-la-carte")],
    }
    subset_scores = {name: {method: score([rows[i] for i in indices], [values[i] for i in indices]) for method, values in estimates.items()} for name, indices in subsets.items()}
    by_chain = {chain: {method: score([r for r in rows if r["chain"] == chain], [v for r, v in zip(rows, values) if r["chain"] == chain]) for method, values in estimates.items()} for chain in sorted({r["chain"] for r in rows})}
    entropy = {macro: {"median_" + key: med([d[key] for d in ds]) for key in ds[0]} for macro, ds in distributions.items()}
    changed = {}
    for macro in MACROS:
        errors = [(ape(ev[macro], r["truth"][macro]), ape(am[macro], r["truth"][macro])) for r, ev, am in zip(rows, estimates["expected_value"], estimates["argmax"])]
        changed[macro] = {"ev_better": sum(a < b for a, b in errors), "argmax_better": sum(a > b for a, b in errors), "tied": sum(a == b for a, b in errors)}
    total_input = sum(u["input_tokens"] for u in usage)
    examples = []
    for identifier in ("waba-grill:bowls/organic-tofu", "waba-grill:sauce-dressing/waba-hot-sauce-packet", "yoshinoya:drinks/aquafina-bottled-water", "yoshinoya:packets/ginger-packet"):
        i = next(i for i, r in enumerate(rows) if r["id"] == identifier)
        examples.append({"id": identifier, "truth": rows[i]["truth"], **{m: v[i] for m, v in estimates.items()}})
    return rows, estimates, {
        "journal_sha256_uncompressed": digest(data), "truth_sha256": events[0]["truthSha256"], "protocol_sha256": events[0]["protocolSha256"],
        "metrics": metrics, "categories": group_scores, "subsets": subset_scores, "by_chain": by_chain,
        "entropy": entropy, "ev_vs_argmax": changed, "suspect_drink_units": suspicious, "examples": examples,
        "open_top_truth": {m: [r["id"] for r in rows if r["truth"][m] >= (2500 if m == "calories" else 200)] for m in MACROS},
        "usage": {"input_tokens": total_input, "median_input_tokens": med([u["input_tokens"] for u in usage]),
                  "output_tokens": sum(u["output_tokens"] for u in usage), "cost_usd": total_input * 0.042 / 1e6,
                  "median_latency_ms": med(latencies), "p95_latency_ms": sorted(latencies)[math.ceil(len(latencies) * .95) - 1]},
    }


def decision_metrics(cases, decisions):
    counts = collections.Counter()
    for row, decision in zip(cases, decisions):
        counts["abstained" if decision is None else ("tp" if row["match"] else "fp") if decision else ("fn" if row["match"] else "tn")] += 1
    result = {k: counts[k] for k in ("tp", "tn", "fp", "fn", "abstained")}
    positive = sum(c["match"] for c in cases)
    result.update(n=len(cases), positives=positive, negatives=len(cases) - positive,
                  accuracy=(counts["tp"] + counts["tn"]) / len(cases), recall=counts["tp"] / positive,
                  fpr=counts["fp"] / (len(cases) - positive),
                  fdr=counts["fp"] / (counts["tp"] + counts["fp"]) if counts["tp"] + counts["fp"] else None)
    return result


def chain_audit(path):
    benchmark = load("scripts/eval/chain-match/benchmark.json")
    observations = load("apps/api/tests/fixtures/__snapshots__/chain-batch-observations.json")
    catalog = load("apps/api/services/chainCatalogs/waba-yoshinoya-2026-09.json")
    definitions = {r["slug"] + ":" + r["canonicalKey"]: r for r in catalog["changes"]}
    data, events = journal(path)
    assert events[0]["benchmarkSha256"] == digest((ROOT / "scripts/eval/chain-match/benchmark.json").read_bytes())
    assert events[0]["thresholds"] == benchmark["thresholds"]
    answers, requests = [], []
    for request, response, _ in alternating(events, [r["id"] for r in benchmark["cases"]]):
        label = benchmark["cases"][len(answers)]
        item = observations[label["observation"]]
        fact = definitions[label["candidate"]]
        expected_state = {
            "menuItem": {"brand": item["slug"], "name": item["name"], "section": item["section"], "description": item["description"]},
            "approvedFact": {"brand": fact["slug"], "canonicalKey": fact["canonicalKey"],
                             **{k: fact["facts"][k] for k in ("servingSize", *OLD_FIELDS)}, "locator": fact["locator"]},
        }
        assert request["request"] == {"model": "jev-latest", "questions": {"chain_item_match": benchmark["question"]}, "state": expected_state}
        assert response["model"] == "jev-1.14.0"
        answer = response["answers"]["chain_item_match"]
        validate_answer(answer, ("match", "no_match"))
        answers.append(answer)
        requests.append(request["request"])
    variants = {}
    for probability, confidence in ((.95, .90), (.95, 0), (.90, 0), (.75, 0), (.5, .90), (.5, 0)):
        # Avoid 1 - .9 becoming .09999999999999998 at the inclusive boundary.
        no_match_probability = round(1 - probability, 12)
        decisions = [None if a["confidence"] < confidence else True if a["choice"] == "match" and a["probabilities"]["match"] >= probability else False if a["choice"] == "no_match" and a["probabilities"]["match"] <= no_match_probability else None for a in answers]
        variants[f"prob_{probability:g}_confidence_{confidence:g}"] = decision_metrics(benchmark["cases"], decisions)
    choices = [a["choice"] == "match" for a in answers]
    variants["choice_only"] = decision_metrics(benchmark["cases"], choices)
    baseline = load(CHAIN_JOURNAL.parent / "baseline.json")
    variants["exact_alias"] = decision_metrics(benchmark["cases"], [r["decision"] for r in baseline["results"]])
    frozen_abstentions = [i for i, a in enumerate(answers) if a["confidence"] < .9 or max(a["probabilities"].values()) < .95]
    return {"journal_path": str(path), "journal_sha256": digest(data),
            "repo_copy_identical": data == (ROOT / CHAIN_JOURNAL).read_bytes(),
            "variants": variants,
            "abstention_positive": sum(benchmark["cases"][i]["match"] for i in frozen_abstentions),
            "abstention_negative": sum(not benchmark["cases"][i]["match"] for i in frozen_abstentions),
            "fails_confidence": sum(a["confidence"] < .9 for a in answers),
            "fails_probability": sum(max(a["probabilities"].values()) < .95 for a in answers),
            "probability_alone_extra": sum(a["confidence"] >= .9 and max(a["probabilities"].values()) < .95 for a in answers),
            "confidence_equals_binary_margin": sum(math.isclose(a["confidence"], abs(a["probabilities"]["match"] - a["probabilities"]["no_match"]), abs_tol=1e-10) for a in answers),
            "unaliased_positives": [{"id": c["id"], "choice": a["choice"], "confidence": a["confidence"], "probability": a["probabilities"]["match"]} for c, a, base in zip(benchmark["cases"], answers, baseline["results"]) if c["match"] and not base["decision"]],
            "serving_missing_on_menu_side": sum("servingSize" not in r["state"]["menuItem"] for r in requests)}


def historical(jev_rows, jev_estimates):
    datasets, runs = {}, []
    for name in APRIL:
        file = Path("scripts/eval/results") / name
        data = load(file)
        rows = [{"id": r["groundTruth"]["id"], "chain": r["groundTruth"]["chain"], "name": r["groundTruth"]["itemName"],
                 "truth": dict(zip(MACROS, [r["groundTruth"]["officialMacros"][k] for k in OLD_FIELDS])),
                 "estimate": dict(zip(MACROS, [r["estimated"][k] for k in OLD_FIELDS]))} for r in data["items"]]
        datasets[data["caseName"]] = rows
        measured = score(rows, [r["estimate"] for r in rows])
        for macro, old in zip(MACROS, OLD_FIELDS):
            assert math.isclose(measured["by_macro"][macro]["mdape"], data["aggregate"][old]["medianAbsPctError"], abs_tol=1e-8)
        runs.append({"file": str(file), "timestamp": data["timestamp"], "model": data["model"], "chains": dict(collections.Counter(r["chain"] for r in rows)),
                     "sources": sorted({r["groundTruth"]["source"] for r in data["items"]}), "metrics": measured})
    datasets["jev-v2-expected-value"] = [{**r, "estimate": e} for r, e in zip(jev_rows, jev_estimates)]
    overlap = {a + " vs " + b: compare(datasets[a], datasets[b]) for a, b in itertools.combinations(datasets, 2)}
    hero = load("scripts/eval/hero-eval/ground-truth.json")
    fixture = [{"chain": c["name"], "name": i["name"]} for c in hero["chains"] for i in c["items"]]
    fixture_keys = {identity(r) for r in fixture}
    paths = sorted(set((ROOT / "scripts/eval/results").rglob("*.json")) | set((ROOT / "scripts/eval/results").rglob("*.jsonl")) | set((ROOT / "scripts/eval-v2").rglob("*.json")))
    qwen_files = [str(p.relative_to(ROOT)) for p in paths if "qwen" in p.read_text().casefold()]
    return {"april": runs, "overlaps": overlap, "qwen_raw_files_found": qwen_files, "searched_result_file_count": len(paths),
            "july160_fixture_chains": {c["name"]: len(c["items"]) for c in hero["chains"]},
            "july160_vs_april_name_overlap": len(fixture_keys & {identity(r) for r in next(iter(datasets.values()))}),
            "july160_vs_jev_name_overlap": len(fixture_keys & {identity(r) for r in jev_rows}),
            "jev_duplicate_name_keys": {" | ".join(k): n for k, n in collections.Counter(identity(r) for r in jev_rows).items() if n > 1}}


def truth_audit():
    truth = load("scripts/eval/jev-macro/truth.json")
    for source in truth["sources"]:
        assert digest((ROOT / source["file"]).read_bytes()) == source["sha256"], source["file"]
    extraction = load("apps/api/tests/fixtures/__snapshots__/chain-batch-source-extraction.json")
    catalog = load("apps/api/services/chainCatalogs/waba-yoshinoya-2026-09.json")
    products = load("apps/api/services/chainCatalogs/chain-quality-2026-09-input.json")
    source_rows = {(r["brand"].replace("waba", "waba-grill") + ":" + r["canonicalKey"]): r for r in extraction if r["factStatus"] == "accepted"}
    definitions = {r["slug"] + ":" + r["canonicalKey"]: r for r in catalog["changes"]}
    bindings = {r["slug"] + ":" + r["canonicalKey"]: r for r in products["bindings"]}
    product_rows = {r["key"]: r for r in products["products"]}
    checked, spots = collections.Counter(), []
    for row in truth["rows"]:
        values = [row[k] for k in TRUTH_FIELDS]
        if row["source"]["provenance"] == "official-pdf":
            source = source_rows[row["id"]]
            definition = definitions[row["id"]]
            assert values == [source[k] for k in OLD_FIELDS]
            assert [math.floor(values[0] + .5), *values[1:]] == [definition["facts"][k] for k in OLD_FIELDS]
            assert row["source"]["url"] == definition["source"]["url"] and row["source"]["publishedSha256"] == definition["source"]["sha256"]
            assert row["source"]["locator"] == definition["locator"]
        else:
            source = product_rows[bindings[row["id"]]["productKey"]]
            assert values == [source["facts"][k] for k in OLD_FIELDS]
            assert row["serving"] == source["facts"]["servingSize"]
            assert row["source"]["url"] == source["source"]["url"] and row["source"]["publishedSha256"] == source["source"]["sha256"]
            assert row["source"]["locator"] == source["locator"]
        checked[row["source"]["provenance"]] += 1
        if row["id"] in SPOT_IDS:
            spots.append({"id": row["id"], "values_cal_p_c_f": values, "serving": row["serving"],
                          "locator": row["source"]["locator"], "source_file": row["source"]["file"],
                          "extraction_file": row["source"]["extractionFile"], "published_sha256": row["source"]["publishedSha256"], "source_values_match": True})
    assert len(spots) == 15
    return {"pinned_files_verified": len(truth["sources"]), "checked_rows": dict(checked), "spot_checks": spots,
            "exclusions": len(truth["exclusions"])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--macro-journal", type=Path, default=ROOT / MACRO_DIR / "jev-raw.jsonl.gz")
    parser.add_argument("--out", type=Path, help="Write JSON exclusively to a new file; default: stdout")
    args = parser.parse_args()
    rows, estimates, macro = macro_audit(args.macro_journal)
    # Prefer the user's live evidence path when readable; otherwise use the repo copy.
    live = Path("/tmp/jev-eval-live/jev-raw.jsonl")
    try:
        with live.open("rb"):
            pass
    except OSError:
        live = ROOT / CHAIN_JOURNAL
    output = {"macro": macro, "chain_match": chain_audit(live),
              "historical": historical(rows, estimates["expected_value"]), "truth": truth_audit()}
    text = json.dumps(output, indent=2, allow_nan=False) + "\n"
    if args.out:
        with args.out.open("x") as file:
            file.write(text)
    else:
        print(text, end="")


if __name__ == "__main__":
    main()
