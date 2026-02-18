# Repository Guidelines

## Project Structure & Module Organization
- `src/main/main.js` holds the Electron main-process entry point.
- `src/main/modules/` stores main-process feature modules (for example,
  translation IPC and extension management).
- `src/renderer/` contains the UI layer: `index.html`, `renderer.js`, `styles.css`, `i18n.js`, and `locales/`.
- `src/renderer/fragments/layout/` stores HTML layout fragments loaded by
  `layout-loader.js`.
- `src/renderer/modules/app/events/` stores renderer-side event binding
  modules.
- `src/renderer/modules/ui/translation/` stores translation submodules
  (constants/scripts/dynamic listeners).
- `src/renderer/styles/panels/` stores panel-related split style files.
- `docs/` contains documentation assets.
- `installer/` contains packaging/installer-related assets.
- Top-level project metadata lives in `package.json`, `README.md`, and `CONTRIBUTING.md`.

## Build, Test, and Development Commands
Prerequisites: Node.js >= 16 and npm >= 7.
- `npm install` installs dependencies.
- `npm run dev` launches Electron with the `--dev` flag for development.
- `npm start` runs the app in normal mode.
- `npm run build` builds distributables via `electron-builder`.
- `npm test` is currently a placeholder and exits with an error; update it when adding a test runner.

## Coding Style & Naming Conventions
- Indentation: 2 spaces.
- Quotes: single quotes in JS.
- Line length: keep lines at or below 80 characters where practical.
- Naming: `camelCase` for functions/methods, `PascalCase` for classes.
- Comments: add only when needed; prefer Chinese comments when you do add them.
- There is no formatter or linter configured yet; keep changes consistent with existing files.

## Development Rules (Agent)
- Any file over 500 lines must be split by feature responsibility.
- Naming of split files should reflect behavior, for example:
  `translation-ipc.js`, `extensions-manager.js`,
  `settings-and-panels-events.js`.
- Keep `main.js` as an orchestration entry, move heavy logic to
  `src/main/modules/`.
- Keep `renderer.js` as wiring/bootstrap, move event-binding logic to
  `src/renderer/modules/app/events/`.
- Keep large translation logic modular under
  `src/renderer/modules/ui/translation/`.
- Keep large panel styles split under `src/renderer/styles/panels/` and
  imported by `panels.css`.
- Keep `index.html` lightweight; page structure should be assembled from
  `src/renderer/fragments/layout/`.
- New module boundaries should prefer dependency injection through
  function parameters instead of hidden global state.
- Before committing refactors, run at least:
  `node --check src/main/main.js`
  and `node --check src/renderer/renderer.js`.

## Testing Guidelines
- No testing framework is configured yet.
- If you add tests, wire them into `npm test` and document the location and naming pattern (for example, `tests/*.spec.js`) in `CONTRIBUTING.md`.

## Commit & Pull Request Guidelines
- Commit format:
  - `<type>(<scope>): <subject>` with optional body/footer.
  - Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`.
  - Example: `feat(ui): add dark mode toggle`.
- Branch naming patterns: `feature/...`, `fix/...`, `docs/...`, `refactor/...`, `test/...`, `chore/...`.
- PRs should include:
  - A clear title.
  - A description covering what changed, why it changed, and how it was tested.
  - Links to related issues when applicable.
