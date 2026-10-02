# Native binary reuse cookbook

The simulator CLI uses a verified compatible `.app` by default.
Run `node --env-file=apps/mobile/.env.development.local scripts/sim/product-flow.mjs build <UDID> [--test-store]` before product flows.
`build` prints `action: reuse` and performs no prebuild, Pod install or Xcode compile when the receipt is compatible.
`run` installs that verified artifact and starts a fresh owned Metro process for a Debug Test Store binary.
Every command uses an explicit booted simulator UDID and the existing simulator ownership claim.

```mermaid
flowchart TD
  C[Current resolved native inputs and required profile] --> D{Receipt and app tree intact?}
  D -- no --> B[Build with initial or artifact reason]
  D -- yes --> M{Native input and profile digests match?}
  M -- no --> B
  M -- yes --> R[Reuse app with zero native compiles]
  R --> J{Current JavaScript and public config compatible?}
  J -- owned Metro Debug --> S[Record fresh served bundle hash]
  J -- embedded Release matches --> E[Use recorded embedded bundle hash]
  J -- embedded Release stale --> P[Require compatible Metro profile or appropriate artifact]
  S --> A[Run affected scenarios and acceptance gate]
  E --> A
```

## Exact rebuild inputs

The receipt records `nativeIdentity.inputs`, `profileIdentity.inputs`, and `recipeIdentity.inputs` as well as their hashes, and seals its fields with `receiptHash`.
Generated iOS project and app source files are included even though Expo normally ignores them in Git.
The builder checks source and JavaScript before preparation, after Pod resolution, and after Xcode so edits during a build cannot receive a passing receipt.
The decision reports the changed input paths, such as `native input changed: files.apps/mobile/ios/Native.swift` or `binary profile changed: configuration`.
It never uses HEAD age or a general mobile-source hash as a rebuild reason.

| Change | Native action | JavaScript and acceptance action |
| --- | --- | --- |
| Swift/Obj-C source, generated iOS compile source, resolved Expo or React Native autolinking module, Pod graph, native plugin output or native build recipe | Rebuild with each changed file, graph field or recipe step named | Rerun affected scenarios. |
| Resolved entitlements, permissions, plist, URL scheme, bundle ID, native icon/splash resource, EAS/native build setting | Rebuild with changed config or resource field named | Rerun affected scenarios. |
| Simulator versus device, OS/architecture compatibility, Debug versus Release, Test Store capability, build flags or Xcode/SDK identity | Rebuild for the required profile, naming each changed field | Use the profile that can serve or embed the required JavaScript. |
| Receipt absent, legacy or changed receipt, app absent or tree hash changed | Build with an initial, unverifiable provenance or artifact-integrity reason | Preserve the prior receipt in `.evidence/resume/` before replacement. |
| JavaScript/UI or JS-only package and lockfile change | Reuse the binary if resolved native graph and profile still match | Start fresh owned Metro and capture its served bundle/config hash; rerun affected scenarios. |
| Android-only native source change while testing iOS | Reuse the iOS binary | Keep the iOS acceptance decision tied to affected flows. |
| Unit test or reviewer-input change | Reuse the binary | Retain still-valid product-flow evidence; run the relevant unit or review gate. |
| E2E flow change | Reuse the binary | Rerun affected flow acceptance and retain old raw evidence. |
| Public environment change that changes only `extra` or inlined JavaScript | Reuse the binary | Refresh served bundle/config proof and affected scenarios. |
| Public environment change that changes a native scheme, plist, entitlement or plugin result | Rebuild with the changed resolved config path | Rerun affected scenarios. |

An embedded Release app is accepted only when its build-time JavaScript and public configuration identities still match the candidate.
For Debug, the receipt also binds the Metro URL route and port embedded in the app to the owned server used for evidence.
For newer JavaScript, use an owned Metro Debug binary with the required native capability or build a new embedded Release artifact if that profile is required.
A Test Store key is a Debug capability and cannot be relabeled as Apple sandbox billing proof.

## Example receipts

Reuse decision:

```json
{"action":"reuse","appHash":"<sha256>","nativeIdentity":"<sha256>","profileIdentity":"<sha256>","reason":"verified compatible native artifact"}
```

Permission change:

```json
{"action":"rebuild","reasons":["native input changed: nativeConfig.mods.infoPlist.NSLocationWhenInUseUsageDescription"],"nativeIdentity":"<new-sha256>","profileIdentity":"<same-sha256>"}
```

No artifact:

```json
{"action":"rebuild","reasons":["initial build: no verified compatible native artifact receipt"]}
```

Use `--force-rebuild --reason='specific diagnostic purpose'` only for a deliberate diagnostic compile.
The CLI records that operator reason in the build decision and receipt.
The ordinary `build` command is already the reuse-first entrypoint.
`run` and `check` reject a changed installed app, stale embedded bundle, wrong owned Metro identity, changed acceptance inputs or tampered raw evidence.
Simulator retirement rechecks current native, JavaScript and acceptance identities before it can archive the proof and delete a task device.
Failed and superseded flow reports remain under `.evidence/resume/`, while private publication continues to bind the actual candidate source SHA and artifact hashes.
