# Repository Guidelines

## Project Structure & Module Organization
- `src/main/main.js` holds the Electron main-process entry point.
- `src/renderer/` contains the UI layer: `index.html`, `renderer.js`, `styles.css`, `i18n.js`, and `locales/`.
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
