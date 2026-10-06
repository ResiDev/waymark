# demo

The promo video at the top of the README. A small app (`app/`) is driven through the storyboard by Playwright (`record.ts`), and Remotion (`video/`) edits that footage, adding captions, zooms and a cursor.

```sh
pnpm --filter demo record   # video/public/capture.mp4 and capture.json
pnpm --filter demo render   # out/v<N>/waymark.mp4 and .gif, a new N each time
pnpm --filter demo studio   # preview and tweak the edit
```

Both need ffmpeg on the PATH. Each render keeps the `capture.json` it came from beside it, so earlier cuts stay to compare. Arguments after `--` go to Remotion.

## After a UI change

Run `record` and then `render`. The edit reads its timings from `capture.json`, so a new recording needs no edit changes. The beats, where the camera looks, the pointer and the clicks all come from `record.ts`.

- **Copy, pacing or captions:** `CUTS` in `video/edit.ts`.
- **A changed storyboard:** the beat ids in `record.ts` and `CUTS` must match.
- **A selector or popover text:** the waits in `record.ts` fail loudly when they no longer match.

Remotion is free for individuals and companies of up to 3 people. Anyone rendering for a larger company needs a [company licence](https://www.remotion.pro/license).
