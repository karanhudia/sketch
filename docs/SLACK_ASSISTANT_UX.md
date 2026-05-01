# Slack Assistant UX

State of the Slack surface on `SKE-18/slack-ux-revamp`. Two pieces:

1. **App Home tab** — per-user identity card and progress settings (committed).
2. **Assistant pane DM** — Slack-native shimmer status, threaded replies, no emoji reactions (uncommitted, in working tree).

Everything new is gated behind `config.EXPERIMENTAL_FLAG`. When the flag is off, all behaviour falls back to the legacy DM/channel paths.

## Slack surface taxonomy

| Surface | Slack event | Discriminator | Path |
|---|---|---|---|
| Bot DM, Messages tab | `message.im` | no `thread_ts` | legacy DM (eyes reaction, plain reply, in-thread progress) |
| Bot DM, Assistant tab | `message.im` | `thread_ts` set | new shimmer path |
| Channel @mention / group DM @mention / self-DM @mention | `app_mention` | n/a | unchanged channel-mention handler |
| 1:1 user-to-user DM | none | bot can't be there | n/a |

The Assistant tab and Messages tab share the same DM channel ID; Slack distinguishes them by attaching a `thread_ts` to every Assistant-pane message. That single field is the discriminator used in `adapter.ts`:

```
const isAssistantPaneDm = config.EXPERIMENTAL_FLAG && !!message.threadTs;
```

## App Home tab

Committed in 53c33a9 (+ follow-up). Builder: `packages/server/src/slack/home.ts`. Tests: `home.test.ts`.

`buildHomeView` produces a `views.publish` payload with:

- Identity section: real name, email, org/workspace name (lines omitted when null).
- **Tool progress** `static_select` — options from `TOOL_PROGRESS_OPTIONS` / `TOOL_PROGRESS_LABELS` in `packages/server/src/commands.ts` (`off`, `friendly`, `concise`, `technical`, `verbose`). Action ID: `HOME_ACTION_TOOL_PROGRESS` (`home:set_tool_progress`).
- **Reasoning text** `static_select` — options from `REASONING_TEXT_OPTIONS` / `REASONING_TEXT_LABELS` (`on`, `off`). Action ID: `HOME_ACTION_REASONING_TEXT` (`home:set_reasoning_text`).
- Static "How to use" hints.

Both selects expose `initial_option` set from the user's current settings, so the dropdown reflects state on every publish.

### Bot wiring (`packages/server/src/slack/bot.ts`)

- `app_home_opened` event listener — filters to the `home` tab, forwards to `onAppHomeOpened` handler.
- Action listener registered with regex `/^home:.+/` — `ack`s, then forwards `{ slackUserId, actionId, value }` to `onHomeAction`. `value` is read from `selected_option.value` (with a `value` fallback).
- `setAssistantStatus(channelId, threadTs, status, loadingMessages?)` — wraps `assistant.threads.setStatus`, passes `loading_messages` when provided.
- `publishHomeView(slackUserId, view)` — wraps `views.publish`.
- `postThreadReply(channelId, threadTs, text)` — used for Assistant-pane replies.

### Adapter wiring (`packages/server/src/slack/adapter.ts`, uncommitted)

Inside `if (config.EXPERIMENTAL_FLAG)`:

- `publishHomeForUser(slackUserId)` resolves the user, reads progress settings via `resolveProgressDisplaySettings`, builds the view, and calls `slackBot.publishHomeView`.
- `onAppHomeOpened` → `publishHomeForUser`.
- `onHomeAction` → resolve user, validate `value` against `TOOL_PROGRESS_OPTIONS` / `REASONING_TEXT_OPTIONS`, call `repos.users.update({ toolProgress })` or `repos.users.update({ reasoningText })`, then re-publish so the dropdown's `initial_option` reflects the new state immediately.

## Assistant pane DM

Uncommitted in working tree.

### Detection

`isAssistantPaneDm = config.EXPERIMENTAL_FLAG && !!message.threadTs` in the DM handler. When true:

- `assistantThreadTs = message.threadTs`.
- `addReaction("eyes")` / `removeReaction("eyes")` / `addReaction("white_check_mark")` are skipped — they don't render usefully in the Assistant pane.
- `progressTransport` is set to `null` — the in-thread edit-in-place progress message is replaced by the shimmer.
- The final-message handler (`createSlackMessageHandler`) is created with the thread TS so replies go via `postThreadReply` rather than as new top-level DMs. Error replies and "_No response_" fallbacks also use `postThreadReply`.

### Shimmer status

`setAssistantStatusLine(line)` calls `slackBot.setAssistantStatus(channel, threadTs, line, ASSISTANT_SHIMMER_POOL)` on each `tool_use` event, with `line` taken from the renderer's last line (after dedup). Slack renders this verbatim; with the bot named "Sketch" the pane shows e.g. `Sketch 📖 Flipping through some pages`.

`ASSISTANT_SHIMMER_POOL` (exported from `packages/server/src/agent/tool-progress.ts`) is a deduplicated array of up to 10 phrases drawn from the `FRIENDLY_MESSAGES` table — the full `Fallback` pool first, then the first phrase per other tool. It's passed as Slack's `loading_messages` array so the pane animates between phrases when no fresh status is set.

Lifecycle:

- Run start: `setAssistantStatusLine("Thinking…")` so the shimmer is non-empty before the first tool event.
- On each `tool_use` event whose rendered last line changed: re-call `setAssistantStatus` with the new line. Calls are direct — no throttling, no reformatting, the friendly emoji-prefixed line is sent verbatim.
- Run end (success and error paths): `setAssistantStatus(channel, threadTs, "")` clears the shimmer.

### Fallback (flag off)

`isAssistantPaneDm` is false; the handler falls through to the legacy DM path: eyes reaction on receive, in-thread progress message via `createSlackProgressTransport`, `white_check_mark` on success, plain top-level `postMessage` for replies.

## Channel @mentions

Unchanged in this revamp. The existing flow still uses `createSlackProgressTransport` with edit-in-place updates inside the thread, eyes/✅ reactions, and `postThreadReply` for the final answer.

## Slack app config requirements

- **AI Assistant** feature enabled in app config + `assistant:write` scope — required for `assistant.threads.setStatus` / Assistant pane to work.
- **App Home** feature enabled, with the `app_home_opened` event subscription and `views.publish` available via the bot's standard scopes.

Without `assistant:write`, `setAssistantStatus` calls fail and are logged at warn level; the run still completes, just without shimmer.

## Tests

- `packages/server/src/slack/home.test.ts` — covers identity rendering and both selects' action IDs / option lists / `initial_option`.
- `packages/server/src/slack/adapter.test.ts` — covers the Assistant-pane branch: `setAssistantStatus("Thinking…")` on start, per-tool status updates, `setAssistantStatus("")` on completion, and that eyes / ✅ reactions are skipped when `threadTs` is present and the flag is on.
