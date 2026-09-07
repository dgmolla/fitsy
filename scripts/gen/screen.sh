#!/usr/bin/env bash
# T1: scaffold a mobile screen in the expected shape: themed, testID'd, and
# registered in the FEATURE_MAP (the L7 verifier reads it).
#
#   scripts/gen/screen.sh <route>            e.g. scripts/gen/screen.sh settings/units
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SEG="${1:?screen route, e.g. settings/units}"
FILE="$REPO_ROOT/apps/mobile/app/$SEG.tsx"
[ -e "$FILE" ] && { echo "$FILE already exists" >&2; exit 1; }
mkdir -p "$(dirname "$FILE")"
NAME="$(basename "$SEG")"
PASCAL="$(python3 -c "import sys;print(''.join(w.capitalize() for w in sys.argv[1].replace('_','-').split('-')))" "$NAME")"
TID="$(echo "$SEG" | tr '/' '-')"

cat > "$FILE" <<SCREEN
import React from 'react';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';

/**
 * ${PASCAL} screen (/${SEG}).
 *
 * Every interactive element needs a testID (lint warns otherwise) so E2E
 * flows and the agent verifier can target it. Register this screen in
 * apps/mobile/FEATURE_MAP.md - the context the L7 verifier drives from.
 */
export default function ${PASCAL}Screen() {
  return (
    <SafeAreaView style={s.container} testID="${TID}-screen">
      <View style={s.content}>
        <Text>${PASCAL}</Text>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, padding: 16 },
});
SCREEN

echo "generated: ${FILE#$REPO_ROOT/} (testID: ${TID}-screen)"
echo "next:"
echo "  - add a row to apps/mobile/FEATURE_MAP.md (route, reached-by, anchor)"
echo "  - if the screen is flow-critical, add a Maestro flow under apps/mobile/e2e/flows/"
echo "  - npm run verify before pushing"
