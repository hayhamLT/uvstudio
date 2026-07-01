# macOS code signing + notarisation

Signed + notarised builds open without the "unidentified developer / damaged"
Gatekeeper warning. The CI is already wired for it — it activates the moment the
six repo secrets below exist; until then builds are simply unsigned.

## Prerequisite

- **Apple Developer Program** membership ($99/yr) — required for a Developer ID
  certificate and notarisation. https://developer.apple.com/programs/

## One-time: create the certificate

1. **Keychain Access ▸ Certificate Assistant ▸ Request a Certificate from a
   Certificate Authority** → save a `CertificateSigningRequest.certSigningRequest`
   to disk (enter your email; choose "Saved to disk").
2. **developer.apple.com ▸ Certificates ▸ +** → **Developer ID Application** →
   upload the CSR → download the `.cer` → double-click to add it to your login
   keychain.
3. In **Keychain Access**, find **"Developer ID Application: … (TEAMID)"**,
   right-click → **Export** → save a **`.p12`** and set an export password.

   *(Shortcut: Xcode ▸ Settings ▸ Accounts ▸ Manage Certificates ▸ + ▸
   Developer ID Application also creates it, then export the `.p12` as above.)*

## The six GitHub secrets

Add these at **GitHub ▸ repo ▸ Settings ▸ Secrets and variables ▸ Actions ▸
New repository secret** (do **not** paste them into chat or commit them):

| Secret | Value / how to get it |
|--------|----------------------|
| `APPLE_CERTIFICATE` | the `.p12` base64-encoded: `base64 -i cert.p12 \| pbcopy` |
| `APPLE_CERTIFICATE_PASSWORD` | the password you set when exporting the `.p12` |
| `APPLE_SIGNING_IDENTITY` | exact identity string, e.g. `Developer ID Application: Your Name (AB12CD34EF)` — list with `security find-identity -v -p codesigning` |
| `APPLE_TEAM_ID` | your 10-char Team ID (developer.apple.com ▸ Membership) |
| `APPLE_ID` | your Apple ID email |
| `APPLE_PASSWORD` | an **app-specific password** — appleid.apple.com ▸ Sign-In & Security ▸ App-Specific Passwords (NOT your real password) |

## Ship it

Tag a release as usual (`git tag vX.Y.Z && git push origin vX.Y.Z`). CI now:
1. imports the certificate, signs the `.app` with the **hardened runtime** +
   [`entitlements.plist`](../src-tauri/entitlements.plist),
2. submits to Apple **notarisation** and **staples** the ticket to the `.dmg`.

The published `.dmg` then opens cleanly on any Mac. Notarisation adds a few
minutes to the build.

## Notes

- Entitlements allow JIT / executable memory — WKWebView (Tauri's renderer)
  needs them to run under the hardened runtime; without them a notarised build
  would crash on launch.
- Windows signing is separate (EV/OV cert) — not set up yet.

## Updater signing (separate from Apple)

The in-app auto-updater verifies each update against a **minisign** key before
installing (`plugins.updater.pubkey` in `tauri.conf.json`). CI signs the update
artifacts with the repo secrets `TAURI_SIGNING_PRIVATE_KEY` (+ `_PASSWORD`,
empty). The private key also lives at `~/.tauri/uvstudio.key` on the dev
machine — **back it up**; if it's lost, shipped apps will refuse future updates
(the pubkey would have to change and users must reinstall manually).

Local `tauri build` needs the key too (createUpdaterArtifacts):
`export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/uvstudio.key)"`.
