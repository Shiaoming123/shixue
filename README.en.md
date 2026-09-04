# Shixue

Shixue is a local-first study assistant that turns learning ideas into planned, traceable, evidence-backed tasks.

Its core loop is:

`Capture → clarify → schedule → focus → evidence-backed completion → 1/3/7-day review`

The interaction model borrows the clarity of TickTick's Today, lists, focus timer, and review surfaces, but the domain is purpose-built for learning records rather than general task management. Version 0.2 adds a learning inbox, a cross-topic Today queue, task lifecycle history, persistent checklists, and a searchable completion library.

## Run

```bash
npm ci
npm run dev:web
```

For Tauri desktop development:

```bash
npm run tauri dev
```

## Verify

```bash
npm run verify
npm run rust:verify
npm run smoke:web-persistence
```

The Web build and IndexedDB persistence have been browser-verified. Rust checks pass. Packaged Windows lifecycle testing and native iOS/Android device testing have not been performed yet.

See the [visual fidelity ledger](./docs/design/fidelity-ledger.md) and [product research](./docs/product-research.md) for the product decisions and current boundaries.
