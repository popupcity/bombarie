# Bombarie

A social media planner where every post is a markdown file. You write posts, plan them on a calendar, and Bombarie posts them at the planned time, or reminds you when a platform has no API. Content lives in plain files you can read, edit and keep in git. It runs as one small container with no database.

Built by [Pop-Up City](https://popupcity.net), an urban innovation studio, for its own use, because the existing tools did not fit. It is shared as it is: no support, pull requests welcome.

## What it does

- A calendar and a list of everything planned, posted and late, with a live preview per platform.
- Posts to LinkedIn, Instagram, Facebook and Threads through their APIs. Substack and your own blog are shown from their RSS feeds; Substack posts are reminders, because Substack has no posting API.
- One post, several channels: a post folder holds one markdown file per channel, so each channel can have its own text and pictures.
- Replies on Threads (and comments on LinkedIn) after the first `---` in a post.
- An ideas inbox you can fill from a bookmarklet or a Telegram bot, and entities (`[[Name]]`) that become real mentions on LinkedIn and Instagram.
- A late post is skipped, never posted late.

## Status per platform

What follows is what has been used live, not what the code claims. Everything else is built and tested with mocks only.

| Platform | Used live | Built, not verified |
|---|---|---|
| LinkedIn (person) | text, images, a comment on a post | delete a post or a comment, PDF, video |
| Instagram | one picture, a carousel | story, Reel, video |
| Threads | text, pictures, a video, a reply | delete (Threads does not allow it) |
| Facebook page | nothing yet | text, pictures |
| Substack | notes as reminders | nothing is posted automatically |
| LinkedIn company page | not supported | |

Each platform needs your own developer app (Meta, LinkedIn, Threads). The setup steps are shown in the app under Channels, Add channel. LinkedIn comments use the `w_member_social` scope.

## Run it

You need Docker and an https address in front of it (Meta and LinkedIn only redirect to https, and Instagram and Threads fetch pictures from your public address).

```
curl -O https://raw.githubusercontent.com/popupcity/bombarie/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/popupcity/bombarie/main/.env.example
cp .env.example .env
```

Sign-in is with GitHub. Register an OAuth app at github.com/settings/developers (homepage: your address, callback: `https://<your address>/login/github/callback`, no scopes are needed) and put its client ID and secret in `.env`, with the GitHub names that may sign in in `BOMBARIE_ADMINS`. Then:

```
docker compose --env-file .env up -d
```

Open `http://localhost:4321`, sign in, and use Add channel. The first channel creates `channels.yml`.

| Variable | Needed | What it is |
|---|---|---|
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | yes | The OAuth app that signs people in. Only the GitHub user name is read; the GitHub token is not kept. |
| `BOMBARIE_ADMINS` | yes | GitHub names that may sign in, separated by commas, for example `jeroen,anna`. |
| `BOMBARIE_SECRET` | yes | A long random string (`openssl rand -base64 32`). It encrypts the platform tokens and app keys in `config/` and signs the session cookies. Keep a copy: without it the tokens cannot be read and you connect your channels again. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | no | Reminders and ideas by Telegram, for your chat only. |
| `BOMBARIE_ROOT` | no | Content folder. `/data` in Docker, `./data` when you develop. |
| `BOMBARIE_TOKENS`, `BOMBARIE_APPS` | no | Where the platform tokens and app keys live. `/config/...` in Docker. |

## Your content

Two folders hold everything, and both are mounted by `docker-compose.yml`:

- `data/`: your content. Back this up, or make it a git repository.
- `config/`: platform tokens and app keys (`tokens.json`, `apps.json`). Secrets: never put these in git. Both files are encrypted (AES-256-GCM) with `BOMBARIE_SECRET`, so a backup of `config/` alone reveals nothing.

```
data/
  channels.yml
  posts/2026-12-01-launch/
    jeroen-linkedin.md           one file per channel
    jeroen-linkedin.state.json   what the app did: status, remote id, replies
    01.jpg
  ideas/2026-11-25-an-idea/idea.md
  entities/pop-up-city.md        name: Pop-Up City, linkedin: urn:..., instagram: ...
  avatars/
```

A post file:

```
---
date: 2026-12-01T09:00
title: Launch
status: planned
images: [01.jpg]
---
Opening today at [[Pop-Up City]].

---

A reply, posted under the post on Threads.
```

`status: planned` makes it due at `date`. Without it the post stays a draft. `manual: true` makes it a reminder only. The `.state.json` file next to a post is written by the app; deleting it makes the app forget that the post was posted.

## Update

```
docker compose pull && docker compose up -d
```

## Develop

```
pnpm install
pnpm dev          http://localhost:4321, content in ./data
pnpm test         node's test runner
pnpm typecheck
pnpm build
```

`src/` is the core without any framework (types, providers, state, planning). `app/` is the Astro UI. `packages/ui` is the design system. Styling is Tailwind classes only. The decisions and their reasons are in `docs/decisions.md`.

## Limits

- One process: the scheduler runs inside the app and checks every minute. If the container is down at the planned time, the post is skipped after an hour.
- Users are all equal: anyone who can sign in can plan and post on every channel.
- Whoever has both `config/` and `BOMBARIE_SECRET` has your tokens, and Meta and LinkedIn change their APIs. Expect to reconnect a channel now and then.

## Licence

GNU Affero General Public License v3.0, see `LICENSE`. Copyright (c) 2026 Pop-Up City. Contributions are welcome under the terms in `CONTRIBUTING.md`; third-party code is listed in `THIRD-PARTY-NOTICES.md`.
