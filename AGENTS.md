# Working agreement

## Read before changing code

1. Read both `README.md` and `README.en.md` for product scope and maturity labels. Any README content change must update both languages in the same change and keep claims, links, commands, and maturity labels aligned.
2. Read `docs/README.md`, then the document for the area being changed.
3. Read the immediate callers, exports, tests, and configuration before editing.
4. For development and release checks, read `docs/development.md` and `docs/release-kit.md`. For Windows packaging, updater, release assets, or Authenticode changes, also read `docs/windows-distribution.md` and `docs/windows-v0.2.3-release-retrospective.md`.
5. For visible UI work, read root `DESIGN.md` and `VISUAL_QA.md` before editing. If `DESIGN.md` is `LOCKED`, reuse its tokens, layout, interaction, and component contracts; update the contract and obtain design approval before introducing a new visual mode or major deviation.

## Boundaries

- This is a Tauri 2 + Vue 3 starter. Desktop is the primary target; Web and mobile responsive support have the maturity stated in the README.
- Keep modules behind the existing configuration, loader, runtime-capability, and Rust feature boundaries. Do not make optional modules load by default.
- Treat the WebView as untrusted for secrets. Never commit credentials, private keys, certificates, provisioning profiles, or `.env` values; never print them in logs, tests, documentation, or issues.
- Do not turn template updater endpoints or optional release secrets into a release claim. Signing, notarization, store submission, and hosted delivery require separate verified platform work.
- Do not expose browser or operating-system default control chrome. Every visible button, select/listbox, combobox, checkbox, radio, switch, menu, popover, date/time picker, dialog, sheet, tooltip, toast, and scrollbar must use the shared themed UI layer. Native controls may remain as hidden semantic or accessibility underlays.
- Human UI, keyboard shortcuts, notification actions, and future agents must call the same versioned capability service; none may write the persisted workspace snapshot directly.

## Changes and verification

- Keep changes small and preserve unrelated working-tree changes.
- Add or update focused tests for changed behavior. Run the applicable gates:

| Change | Required checks |
| --- | --- |
| TypeScript/Vue or scripts | `npm test`, `npm run typecheck`, `npm run build`, `npm run build:web` |
| Documentation | `npm run check:docs` |
| Release configuration | `npm run release:check` |
| Full frontend change | `npm run verify` |
| Rust/Tauri change | `npm run rust:verify` |
| Visual UI change | fixed-viewport screenshots and the state matrix in `VISUAL_QA.md` |

`npm run doctor` is the prerequisite diagnostic; it reports configuration and filesystem conditions without reading or displaying secret values.

## Definition of Done

A change is done when its intended behavior has focused test coverage, the relevant commands above pass, documentation and maturity claims match what was actually verified, and the diff contains no generated artifacts or secrets.
