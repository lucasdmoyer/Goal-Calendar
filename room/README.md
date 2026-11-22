# Room

A small personal coaching app built around having enough room to live. Capture ideas without turning them into obligations, choose at most two active discretionary goals, and let today's capacity shape one optional next action.

## Run

This is buildless HTML, CSS, and browser JavaScript with no package dependencies.

```sh
python3 -m http.server 8000 --directory dist
```

Open `http://localhost:8000`. Serve over HTTP instead of opening the HTML directly because browser modules require an origin. For hosting, deploy the contents of `dist` as static files. The host's access policy is responsible for any sign-in gate.

```sh
node --test tests/*.test.mjs
```

## What it does

- A daily capacity check, a place for real commitments, and at most one optional action.
- A quick inbox, editable goals, active/parked/finished states, and a two-goal active limit.
- A gentle health and connection reminder chosen by the person using it.
- A weekly reset that asks what to remove as well as what matters.
- Browser-local persistence and manual JSON export/import.
- A portable coaching brief to paste into a conversational assistant yourself.

Coaching is deterministic and explainable. There is no live language model, background agent, calendar access, health-data connection, push notification, or automatic cross-device sync. Completing a daily action does not mark a whole goal finished.

## Personal data

Entries remain in localStorage for this browser origin. They are not sent to GitHub, a language model, or an application database. They are not encrypted by the app; anyone with access to the same browser profile may be able to read them. Clearing site data can remove entries. Export a backup when useful. Exported JSON and copied coaching briefs contain the personal information entered in the app, so share them deliberately.

The public repository uses generic example defaults. Do not commit personal exports, private profile defaults, medical records, credentials, or API keys. A private host restricts access to the app; it does not create encrypted or synchronized storage for browser entries.

## Product policy

See [the design notes](docs/DESIGN.md). This app supports reflection and planning, not diagnosis or treatment. Health defaults are suggestions the user can edit; the app does not infer health or readiness from a wearable score. Another person's participation and information remain their choice.

## A future conversational coach

If user testing shows this reduces mental load, a next version can add authenticated storage and a server-side language-model call. Keep the deterministic policy as the boundary: proposed changes need confirmation; parked ideas never silently become active; a low-capacity day can have no optional action; real deadlines remain visible. Store only the context needed, expose editable memory and deletion, protect secrets server-side, and let each person choose what to share.
