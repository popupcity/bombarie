# Bombarie

Git- and markdown-based social media planner. Astro SSR on Node, one container, no database. Detail, history and every design decision: `docs/decisions.md`. Read it by section (`grep -n '^#' docs/decisions.md`), never whole.

## Rules

- pnpm only. `pnpm test` (`node --test "src/**/*.test.ts"`), `pnpm typecheck`, `pnpm build`.
- No backwards compatibility: renames and format changes get no migrations, fallbacks or aliases.
- Styling is always Tailwind utility classes (and `@theme` tokens, which are Tailwind's own config). Custom CSS or arbitrary values only when Tailwind cannot do it, and then say why in `docs/decisions.md`.
- No comments in shipped code; rationale goes in `docs/decisions.md`.
- UI text, code, docs and commits are English. Commit messages: a short subject, a body only when the why is not obvious.

## Layout

- `src/` core, framework-free: types, time, text, frontmatter, mentions, providers (linkedin, instagram, facebook, threads), state, run, connect, media. Tests sit next to code as `*.test.ts`.
- `app/` Astro UI: `pages/`, `components/`, `layouts/`, `lib/`, `scripts/`.
- UI uses the `@popupcity/ui` library (`packages/ui`, a workspace package copied from `~/Sites/ui`: the components and the `social` theme only): always its components (`Text`, `Heading`, `Card`, `Alert`, `Button`, `Input`, `Icon`), never raw text elements or ad-hoc cards.
- Tests enforce the systems: `src/spacing.test.ts` (vertical rhythm), `src/buttons.test.ts` (icons on buttons), `src/colours.test.ts` (named colours only). Run them after UI changes.

## Content

All content is in one folder, `data/` (gitignored; `BOMBARIE_ROOT` in Docker is `/data`). It can be its own git repo. Tokens and app secrets are in `config/`, outside it.

- `data/posts/<date>-<slug>/<channel>[-<type>].md`, one file per channel variant; `data/ideas/<date>-<slug>/idea.md`; `data/entities/<slug>.md` with `name:`; `data/channels.yml`; `data/avatars/`.
- State in `posts/<folder>/<variant>.state.json` (posted, posting, failed, unconfirmed, reminded, deleted), next to the post, never in its markdown. Feed items are in `data/.state/_feeds/`. `manual: true` posts are not posted, only reminded.
- Plain text body; `[[Name]]` is the only link form.
- A due post over an hour late is skipped (`LATE`), never posted late.
