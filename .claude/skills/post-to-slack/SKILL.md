---
name: post-to-slack
description: Post iPhone simulator screen recordings to Slack. Use after making UI changes to share a recording of the new behavior with the team.
---

Post an iPhone simulator recording to Slack. Use this skill whenever a UI change has been demonstrated via screen recording.

## What you need

1. A `.mp4` recording path (from `mcp__mobile-mcp__mobile_stop_screen_recording` or a known file like `/tmp/*.mp4`)
2. A Slack channel name or ID (default: `C0ANF717GBC` / `#clahh` unless the user specifies otherwise)
3. An optional caption describing what changed

## Recording requirements

**The recording MUST capture the changed functionality in action.** Before uploading:

- The recording must be **non-zero duration** — verify with `ls -lh <path>`. If file size < 100KB, re-record.
- **The specific change must be visible.** If the feature is blur behind a sheet, the sheet must open and the blur must render clearly. If it's an animation, the full animation must play. Never post a static or empty recording.
- Recording steps for a UI interaction:
  1. `mobile_start_screen_recording` → save path
  2. Navigate to the screen in the app
  3. Trigger the changed feature — wait for it to fully render
  4. Hold for 2–3 seconds so the effect is visible
  5. Dismiss / close — let it animate out
  6. `mobile_stop_screen_recording` — confirm output file size > 100KB

## Steps

1. **Identify the recording file**: Use the most recent recording path, or take a fresh one following the Recording requirements above.

2. **Verify the recording**: Run `ls -lh <path>`. If < 100KB, re-record.

3. **Compose the caption**:
   ```
   📱 <Feature/screen name> — <what changed>
   ```
   Example: `📱 Macro Edit Sheet — blur intensity increased (BlurView 80→120)`

4. **Upload to Slack** using the 3-step Slack API (bot token from `$SLACK_BOT_TOKEN`):

   **Step 1** — get upload URL:
   ```bash
   curl -s -X POST "https://slack.com/api/files.getUploadURLExternal" \
     -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
     -H "Content-Type: application/x-www-form-urlencoded" \
     --data-urlencode "filename=<filename>.mp4" \
     --data-urlencode "length=$(wc -c < <path> | tr -d ' ')"
   # → returns upload_url and file_id
   ```

   **Step 2** — upload the file:
   ```bash
   curl -s -X POST "<upload_url>" \
     -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
     --data-binary @"<path>"
   ```

   **Step 3** — complete and share to channel:
   ```bash
   curl -s -X POST "https://slack.com/api/files.completeUploadExternal" \
     -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"files":[{"id":"<file_id>"}],"channel_id":"<channel_id>","initial_comment":"<caption>"}'
   ```

5. **Confirm**: Report that the video was posted to the channel.

## Channel defaults

- `C0ANF717GBC` (`#clahh`) — use this unless the user specifies otherwise

## Error handling

- If `SLACK_BOT_TOKEN` is not set: tell the user to export it in their shell and restart Claude Code
- If the file doesn't exist or is empty: re-record before uploading
