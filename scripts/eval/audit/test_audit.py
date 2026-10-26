#!/usr/bin/env python3
"""Offline checks for audit boundaries and preservation of paired identity."""

import copy
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import jev_qwen_audit as audit
import rerun_design as design


def row(name="Big Mac", truth=100, estimate=150):
    return {"chain": "McDonald's", "name": name,
            "truth": {m: truth for m in audit.MACROS},
            "estimate": {m: estimate for m in audit.MACROS}}


class AuditTests(unittest.TestCase):
    def test_zero_truth_and_strict_catastrophic_boundary(self):
        self.assertEqual(audit.ape(0, 0), 0)
        self.assertEqual(audit.ape(0.01, 0), 100)
        r = row()
        self.assertEqual(audit.score([r], [r["estimate"]])["catastrophic"], 0)
        r["estimate"]["calories"] = 150.0001
        self.assertEqual(audit.score([r], [r["estimate"]])["catastrophic"], 1)

    def test_normalization_keeps_serving_sizes(self):
        self.assertEqual(audit.normalize("McDonald’s®"), "mcdonalds")
        self.assertEqual(audit.normalize("Chicken & Rice™"), "chicken and rice")
        self.assertNotEqual(audit.normalize("Pepsi 12 oz"), audit.normalize("Pepsi 20 oz"))

    def test_pairing_excludes_ambiguous_names_and_unequal_truth(self):
        a, b = row(), row(name="Big Mac®", estimate=120)
        paired = audit.compare([a], [b])
        self.assertEqual(paired["paired_n"], 1)
        self.assertEqual(paired["left"]["by_macro"]["calories"]["mdape"], 50)
        self.assertEqual(paired["right"]["by_macro"]["calories"]["mdape"], 20)
        self.assertEqual(audit.compare([a, copy.deepcopy(a)], [b])["paired_n"], 0)
        self.assertEqual(audit.compare([a], [row(truth=200)])["paired_n"], 0)
        self.assertEqual(audit.compare([a], [row(name="Big Mac Large")])["name_overlap"], 0)

    def test_true_bin_midpoints_and_open_top(self):
        self.assertEqual(audit.oracle_bin(0, "calories"), 12.5)
        self.assertEqual(audit.oracle_bin(25, "calories"), 37.5)
        self.assertEqual(audit.oracle_bin(2, "fat"), 3)
        self.assertEqual(audit.oracle_bin(210, "carbs"), 202)
        self.assertEqual(audit.representative("g_200_plus"), 202)

    def test_invalid_probabilities_fail_closed(self):
        answer = {"type": "choice", "choice": "match", "confidence": .1,
                  "probabilities": {"match": .6, "no_match": .4}}
        audit.validate_answer(answer, ("match", "no_match"))
        answer["probabilities"]["match"] = float("nan")
        with self.assertRaises(AssertionError):
            audit.validate_answer(answer, ("match", "no_match"))

    def test_design_uses_explicit_zero_and_does_not_leak_truth(self):
        source = audit.load("scripts/eval/jev-macro/truth.json")["rows"][0]
        state = design.state_for(source)
        self.assertEqual(set(state), {"chain", "itemName", "description", "serving"})
        coarse = design.coarse_request(state)
        self.assertTrue(all(len(q["criteria"]) == 14 for q in coarse["questions"].values()))
        fine = design.fine_request(state, {"calories": "b2", "protein": "zero", "carbs": "b4", "fat": "overflow"})
        self.assertEqual(set(fine["questions"]), {"calories", "carbs"})
        self.assertEqual(fine["questions"]["calories"]["criteria"]["r0"], "500 <= total < 525")
        self.assertTrue(all(len(q["criteria"]) == 10 for q in fine["questions"].values()))
        self.assertEqual(fine["state"], state)

    def test_real_journals_reproduce_archives_with_network_disabled(self):
        with patch("socket.socket", side_effect=AssertionError("Network forbidden during audit")):
            _, _, result = audit.macro_audit(audit.ROOT / audit.MACRO_DIR / "jev-raw.jsonl.gz")
            chain = audit.chain_audit(audit.ROOT / audit.CHAIN_JOURNAL)
            truth = audit.truth_audit()
        self.assertEqual(result["metrics"]["expected_value"]["catastrophic"], 58)
        self.assertEqual(result["metrics"]["argmax"]["catastrophic"], 57)
        self.assertEqual(result["metrics"]["true_bin_midpoint"]["catastrophic"], 10)
        self.assertEqual(chain["variants"]["choice_only"]["tp"], 15)
        self.assertEqual(chain["variants"]["prob_0.9_confidence_0"]["abstained"], 48)
        self.assertEqual(len(truth["spot_checks"]), 15)


if __name__ == "__main__":
    unittest.main()
