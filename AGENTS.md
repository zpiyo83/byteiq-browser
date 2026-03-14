# Repository Guidelines

## Project Overview
ByteIQ Browser is a community-driven AI browser built on Electron 28 and Chromium,
targeting Windows with NSIS packaging. The codebase is split between the main
process (Electron) and renderer (UI) with modularized features.

## Project Structure & Module Organization
- `src/main/`: Electron main process entry and modules.
- `src/renderer/`: UI entry, i18n, HTML fragments, and feature modules.
- `src/renderer/fragments/`: Layout fragments assembled by `index.html`.
- `src/renderer/modules/`: Functional modules (tabs, navigation, UI, storage, etc.).
- `src/renderer/styles/`: Global styles and panel-specific styles.
- `src/renderer/locales/`: i18n JSON files like `zh-CN.json`.
- `tests/`: Jest tests.

## Build, Test, and Development Commands
- `npm install`: Install dependencies.
- `npm start`: Run the app normally.
- `npm run dev`: Run with DevTools enabled.
- `npm run build`: Build Windows NSIS installer.
- `npm test`: Run Jest tests.
- `npm run lint`: ESLint checks.
- `npm run lint:fix`: ESLint autofix.
- `npm run format`: Prettier formatting.

## Coding Style & Naming Conventions
- Indentation: 2 spaces.
- Quotes: single quotes.
- Semicolons: required.
- Line length: 100 chars max.
- No trailing commas.
- Naming: `camelCase` for functions, `PascalCase` for classes.
- Comments: prefer Chinese.
- Keep files under 500 lines; split by feature when larger.
- `main.js` and `renderer.js` should orchestrate only; move logic into `modules/`.

## Testing Guidelines
- Framework: Jest.
- Place tests under `tests/`.
- Name tests by feature or module (e.g., `tests/ai-chat.test.js`).
- Run with `npm test`. Add tests for new features and regressions.

## Commit & Pull Request Guidelines
- Commit format: `<type>(<scope>): <subject>`.
- Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`.
- Branch naming: `feature/`, `fix/`, `docs/`, `refactor/`, `test/`, `chore/`.
- PRs should describe changes, expected behavior, and include screenshots for UI
  changes where applicable.

## Internationalization (i18n)
- JSON structure: `{ "namespace": { "key": "文本" } }`.
- Add languages by copying `src/renderer/locales/zh-CN.json` and registering in
  `src/renderer/i18n.js`.

## Security & Configuration Tips
- Store secrets in runtime config; avoid committing API keys.
- Validate all IPC payloads and keep main-process APIs narrow and explicit.
