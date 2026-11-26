# Bombarie

A social media planner where every post is a markdown file. You write posts, plan them on a calendar, and Bombarie posts them at the planned time, or reminds you when a platform has no API. Content lives in plain files you can read, edit and keep in git. It runs as one small container with no database.

Built by [Pop-Up City](https://popupcity.net), an urban innovation studio, for its own use, because the existing tools did not fit. It is shared as it is: no support, pull requests welcome.

## What it does

- A calendar and a list of everything planned, posted and late, with a live preview per platform.
- Posts to LinkedIn, Instagram, Facebook and Threads through their APIs. Substack and your own blog are shown from their RSS feeds; Substack posts are reminders, because Substack has no posting API.
- One post, several channels: a post folder holds one markdown file per channel, so each channel can have its own text and pictures.
- Replies on Threads (and comments on LinkedIn) after the first `---` in a post.
- An ideas inbox you can fill from a bookmarklet or a Telegram bot (send `/planned` to the bot to see what is coming), and entities (`[[Name]]`) that become real mentions on LinkedIn and Instagram.
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

Each platform needs your own developer app (Meta, LinkedIn, Threads). The setup steps are in the app: open a channel, or add one, and choose Setup guide. LinkedIn comments use the `w_member_social` scope.

## Run it

You need Docker and an https address in front of it (Meta and LinkedIn only redirect to https, and Instagram and Threads fetch pictures from your public address).

```
curl -O https://raw.githubusercontent.com/popupcity/bombarie/main/docker-compose.yml
docker compose up -d
```

Open the address within 15 minutes. Bombarie asks for one thing: an OAuth app at GitHub (the page tells you where to register it and which callback address to give). Then sign in with GitHub: the first account becomes an admin, and admins add everyone else on the Users page. If nobody has set it up after 15 minutes, setup closes; restart the container to open it again.

Then use Add channel. The first channel creates `channels.yml`. There is no `.env` to write; Telegram (reminders and ideas by message) is set on the Settings page.

Optional environment variables in `docker-compose.yml`:

| Variable | What it is |
|---|---|
| `BOMBARIE_SECRET` | Your own key for encrypting the platform tokens and app keys. Without it Bombarie makes `config/secret.key` the first time. Set it if you want a copy of `config/` to be useless without it. Keep a copy: without the key the tokens cannot be read and you connect your channels again. |
| `BOMBARIE_ROOT` | Content folder. `/data` in Docker, `./data` when you develop. |
| `BOMBARIE_TOKENS`, `BOMBARIE_APPS` | Where the platform tokens and app keys live. `/config/...` in Docker. |

## Your content

Two folders hold everything, and both are mounted by `docker-compose.yml`:

- `data/`: your content. Back this up, or make it a git repository.
- `config/`: platform tokens and app keys (`tokens.json`, `apps.json`). Secrets: never put these in git. The files are encrypted (AES-256-GCM). The key is in `config/secret.key`, so a copy of the whole folder can be read; set `BOMBARIE_SECRET` to keep the key elsewhere.

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
media: [01.jpg]
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
- Admins and members differ only in who manages the Users page: everyone who can sign in can plan and post on every channel.
- Whoever has both `config/` and `BOMBARIE_SECRET` has your tokens, and Meta and LinkedIn change their APIs. Expect to reconnect a channel now and then.

## Licence

GNU Affero General Public License v3.0, see `LICENSE`. Copyright (c) 2026 Pop-Up City. Contributions are welcome under the terms in `CONTRIBUTING.md`; third-party code is listed in `THIRD-PARTY-NOTICES.md`.
