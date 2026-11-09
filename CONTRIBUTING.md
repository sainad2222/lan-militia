# Contributing

Thanks for helping. Small, focused pull requests are easiest to review.

## Setup

```sh
npm install
npm start          # build + run on http://localhost:8080
npm test           # build + run all tests
npm run typecheck
```

Open two browser windows to play against yourself. Use your phone on the same Wi-Fi to test touch controls.

## Where things live

See [docs/architecture.md](docs/architecture.md). Most gameplay changes touch `src/shared/constants.ts`, `src/shared/sim.ts` or `src/shared/map.ts`.

## Ground rules

- Keep `src/shared/sim.ts` deterministic. The client predicts with the same code the server runs, and `tests/sim.test.ts` checks it.
- New gameplay rules need a test in `tests/`.
- Test on a phone if you touch controls or rendering, and mention which phone and browser in the PR.
- Keep the client small. Prefer plain canvas code over new dependencies.
- Original art, sound and maps only. Don't add assets taken from other games.

## Reporting bugs

Use the bug report form. Include the device, browser, and the ping/fps numbers from the HUD if the issue is about lag.

By contributing you agree that your contributions are licensed under the [Apache License 2.0](LICENSE).
