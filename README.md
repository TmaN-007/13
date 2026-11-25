# Thirteen — Tiến Lên with friends

A real-time multiplayer **Tiến Lên Miền Nam** (Vietnamese "Thirteen") table for 2–4 players.
Anyone can host a table, share a 4-letter code or link, and the server deals. Empty seats can be filled with bots.

- Authoritative server: hands are never sent to other players' browsers, so you can't cheat by opening dev tools.
- Reconnects automatically: refresh or drop Wi-Fi mid-hand and you get your seat and cards back.
- If someone leaves mid-hand, the house plays out their cards.

## Run it

```bash
npm install
npm start          # http://localhost:3000
```

`npm test` runs the rules engine tests, including 300 full simulated bot games.

## Playing with friends

**Same Wi-Fi:** run `npm start`, then friends open `http://<your-computer's-LAN-IP>:3000`.

**Over the internet, right now (no deploy):** run `npm start`, then in a second terminal:

```bash
npx cloudflared tunnel --url http://localhost:3000
```

It prints a `https://….trycloudflare.com` URL. Send that to your friends. (`ngrok http 3000` works too.)

**Permanently online:** deploy it once and anyone can host from the site.
- **Render** (free tier): New → Blueprint → pick this repo. `render.yaml` is included.
- **Railway / Fly.io / any Docker host:** a `Dockerfile` is included. It listens on `$PORT`.

Free tiers that sleep when idle take a few seconds to wake up for the first visitor.

## Rules implemented

| | |
|---|---|
| Card order | 3 < 4 < … < K < A < **2**; suits ♠ < ♣ < ♦ < ♥ (3♠ lowest, 2♥ highest) |
| Combos | single, pair, triple, four of a kind, straight (3+, no 2s), consecutive pairs (3+ pairs) |
| Beating | same shape and length, higher top card |
| Passing | once you pass you're out until the round ends |
| First lead | lowest card (3♠ with 4 players) leads and must be in the opening play |
| Later leads | previous winner leads (toggle) |
| Chops (chặt heo) | single 2 ← quad / 3 consecutive pairs · pair of 2s ← quad / 4 consecutive pairs · 3 consecutive pairs ← quad / 4 consecutive pairs · quad ← 4 consecutive pairs |

House rules (the host toggles them in the lobby):
- **Tribute (cống)**: last place gives their highest card to the winner; the winner gives back any card they pick.
- **Instant win (tới trắng)**: dealt four 2s, a dragon (3–A), six pairs, or five consecutive pairs.
- **Chop penalties**: getting chopped costs 1 per black 2, 2 per red 2, 3 / 4 / 6 for bombs, and chopping a chop stacks.
- **Stuck pigs (thối heo)**: finish last holding 2s and you pay for them.
- **Frozen (cóng)**: if someone goes out before you've played a card, you finish last and pay 2.
- **Last one standing**: if everyone else leaves mid-hand, the last player at the table wins it. Leaving means clicking Leave, getting kicked, or being disconnected for 60 seconds (time to refresh or reconnect). Bots count as players, so a hand with bots keeps going.
- **Turn timer**: off / 15 / 30 / 45 seconds. When it runs out you pass automatically.

Scoring is zero-sum. Placement points: 4 players +3 / +1 / −1 / −3, 3 players +2 / 0 / −2, 2 players ±1.

## Code layout

```
shared/rules.js   pure rules engine (combos, beats, chops, instant wins), used by server and browser
server/game.js    one hand of play: deal, tribute, turns, passing, chops, scoring
server/room.js    table: seats, host, house rules, bots, timers, reconnects, log/chat
server/bot.js     bot player
server/index.js   Express + Socket.IO
public/           front end (vanilla JS modules, no build step)
test/             node:test suites
```

## Roadmap ideas

The plan is to layer characters, twists and cosmetics on top. `Room.players` is the place to attach a profile (character, card back, table felt).
The card back and felt are plain CSS (`.card.back`, `.felt`), so wardrobe items can just be classes.
