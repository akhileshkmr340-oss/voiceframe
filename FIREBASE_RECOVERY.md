# Firebase client recovery and motion fix

The existing `dist/` photo studio remains untouched. `firebase-client/` recovers the publicly served client from https://voiceframe-studio.web.app/ (version 24, inspected 25 October 2026), including its depth worker and public Firebase web configuration. The private relay backend was not present in this repository and has not been recovered or modified. The client retains its existing `voiceframe-relay.vercel.app` relay configuration.

## Behaviour changed

- AI-video mode requires a non-empty generated video for every scene.
- Quota errors and generation failures stop the job, preserve completed clips, and tell the user to retry. They do not substitute camera movement over stills.
- Re-entering Film or exporting with missing clips retries missing work instead of relying on a once-per-session flag.
- Unreadable video files block export instead of falling back to still images.
- AI clips play forwards once, retimed to the scene length. Gestures are no longer reversed to fill time.
- Photo animation remains an explicit alternative mode.
- The UI reports genuine clip counts, names LTX/Wan, and states that Google Flow and dialogue lip-sync are not connected.

This patch does not produce Google Flow footage, add a Google model/API, increase provider quotas, or implement lip-sync. It prevents incomplete AI video from being misrepresented as completed full-motion footage. Retimed short clips can still look slow if narration is much longer than their source duration.

## Deploy

The supplied Firebase Hosting configuration targets only `voiceframe-studio` in project `voiceframe-6f5b3` and only includes static client files. It does not deploy authentication rules, database rules, Functions, billing changes, or the existing Vercel relay. Review any live custom headers/redirects before deployment; the existing original Hosting manifest was not available in the repository.

From an authenticated Firebase CLI session:

```
firebase hosting:sites:list --project voiceframe-6f5b3
firebase deploy --only hosting --project voiceframe-6f5b3
```

No service-account key or private API token is included. The Firebase web configuration is the public browser configuration already served by the live site.

## Checks

```
node --test tests/firebase-motion.test.mjs
```

Tests use provider mocks and consume no generation credits. End-to-end AI generation and production Firebase deployment must be verified separately; passing these tests does not establish provider availability or generated-video quality.

## Live provider smoke test — 25 October 2026

A single anonymous LTX-Video request, using an original synthetic landscape test image and no paid key, completed successfully. `ffprobe` identified an H.264 file at 896×512, 30 fps, 1.9 seconds, 57 decoded frames; all 57 decoded frame hashes differed. This establishes that this provider call returned a genuine short video at test time. It does not verify dialogue lip-sync, character consistency, a 10-minute generation, or production-site deployment.
