#!/usr/bin/env python3
"""Authenticate cached independent results with an operator-owned external signing key.

The coordinator installs the trusted harness and key; candidate code never installs
trust anchors. Repository writers and the local administrator remain trusted.
"""
import argparse
import hashlib
import json
import pathlib
import subprocess
import sys
import tempfile


def payload(cache, head, base, harness, key):
    return json.dumps({"version": 1, "head_sha": head, "base_sha": base,
                       "harness_sha": harness, "cache_key": key,
                       "verdict_sha256": hashlib.sha256(pathlib.Path(cache).read_bytes()).hexdigest()},
                      sort_keys=True, separators=(",", ":")).encode()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("sign", "verify"))
    for name in ("cache", "head", "base", "harness", "key", "anchor"):
        parser.add_argument("--" + name, required=True)
    args = parser.parse_args()
    receipt = pathlib.Path(args.cache + ".provenance.json")
    expected = payload(args.cache, args.head, args.base, args.harness, args.key)
    with tempfile.TemporaryDirectory(prefix="fitsy-review-provenance-") as directory:
        data = pathlib.Path(directory) / "payload"
        signature = pathlib.Path(directory) / "signature"
        data.write_bytes(expected)
        if args.mode == "sign":
            subprocess.run(["openssl", "dgst", "-sha256", "-sign", args.anchor,
                            "-out", str(signature), str(data)], check=True, capture_output=True)
            value = {"payload": json.loads(expected), "signature": signature.read_bytes().hex()}
            temporary = receipt.with_suffix(".tmp")
            temporary.write_text(json.dumps(value) + "\n")
            temporary.replace(receipt)
        else:
            value = json.loads(receipt.read_text())
            if value["payload"] != json.loads(expected):
                raise ValueError("stale review provenance")
            signature.write_bytes(bytes.fromhex(value["signature"]))
            subprocess.run(["openssl", "dgst", "-sha256", "-verify", args.anchor,
                            "-signature", str(signature), str(data)], check=True, capture_output=True)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print("review provenance unavailable or invalid: " + str(error), file=sys.stderr)
        sys.exit(1)
