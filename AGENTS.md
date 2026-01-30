# Repository Guidelines

## Project Structure & Module Organization

- Monorepo managed by `pnpm-workspace.yaml` with workspace packages under `apps/`, `packages/`, `client/`, `server/`, and `website/`.
- Web client lives in `client/web/` (React/TypeScript, webpack build). Desktop and mobile apps are in `client/desktop/` and `client/mobile/`.
- Backend services and plugins live in `server/` and `server/plugins/`, with shared server packages in `server/packages/`.
- Reusable client packages are under `client/packages/`; documentation site is in `website/`.
- Tests are co-located in `__tests__/` folders and `*.spec.ts(x)` files, with snapshots in `__snapshots__/`.

## Build, Test, and Development Commands

- `pnpm dev`: run web + server dev concurrently (root script).
- `pnpm dev:web`: start web client dev server (`client/web`).
- `pnpm dev:server`: start server dev runner (`server`).
- `pnpm build`: build web, server, and admin; copies web dist into server public.
- `cd client/web && pnpm test`: Jest unit tests for the web client.
- `cd server && pnpm test`: Jest unit tests for server packages.
- `cd client/web/e2e/playwright && pnpm test`: Playwright e2e (Chromium by default).

## Coding Style & Naming Conventions

- Indentation: 2 spaces; LF line endings; final newline required (`.editorconfig`).
- Formatting: Prettier with 80-column print width and single quotes (`.prettierrc.json`).
- Linting: ESLint + TypeScript + Prettier integration (`.eslintrc.js`).
- Test files: `*.spec.ts` / `*.spec.tsx` and `__tests__/` directory naming.

## Testing Guidelines

- Primary unit test framework: Jest (web and server).
- UI testing utilities: React Testing Library (web/desktop).
- E2E: Playwright in `client/web/e2e/playwright/`.
- No global coverage gate is defined; add or update tests alongside feature changes.

## Commit & Pull Request Guidelines

- Commit messages follow Conventional Commits (e.g., `feat: ...`, `fix: ...`, `docs: ...`, `refactor: ...`). Commitlint runs via Husky on `commit-msg`.
- Pre-commit runs `lint-staged` (ESLint + Prettier fixes on staged files).
- PRs should include: a clear description, testing notes (commands + results), and screenshots/GIFs for UI changes.

## Configuration Tips

- Use `pnpm` (enforced by `only-allow` in scripts).
- Local services can be orchestrated with `docker-compose.yml` in the repo root.