# Samite: Claude Code kit

1. Create an empty repo and copy the contents of this folder into its root: `CLAUDE.md`, `brand/` and `design/` sit at the top level.
2. Open the repo in Claude Code and start with:

   > Read CLAUDE.md fully, then open every page in design/prototype/ and look at design/screenshots/ and design/motion/. Do milestone M0 only: the repo, the press ported to TypeScript, and the placeholder for samite.fun. Stop when its acceptance check passes, show me the side-by-side screenshots, and give me the exact DNS records to set at Spaceship.

3. Go one milestone at a time (CLAUDE.md §14). Check each one before saying "next".

| What | Where |
|---|---|
| The spec: product, escrow program, API / SDK / MCP, design system, milestones | `CLAUDE.md` |
| M0 placeholder (open in Chrome) | `design/prototype/placeholder.html` |
| Full landing | `design/prototype/landing.html` |
| The app: board, post a job, job page, machine page | `design/prototype/app.html` (`#board`, `#new`, `#job`, `#machine`) |
| The press: the print engine every picture uses | `design/prototype/samite-press.js` |
| Screenshots (acceptance targets) | `design/screenshots/` |
| Motion references (MP4) | `design/motion/` |
| The four style references (style only; the files stay outside the repo) | `design/reference/README.md` |
| Logo, favicons, avatar, banner, OG card | `brand/` |

Every mainnet transaction (program deploy, config, the first job, turning on the keeper) is run by the owner, never by Claude Code. Fill `.env` yourself; never paste keys into the chat.
