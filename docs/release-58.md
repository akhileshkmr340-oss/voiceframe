# VoiceFrame workspace update

This snapshot recovers the currently deployed v57 public client, because the repository's older main branch did not match production. The existing dist app is preserved.

Changes:
- Responsive graphite/lime studio, production navigation, shot library, preview and export panels.
- New projects default to full AI motion. Basic and hybrid animation remain explicit choices.
- Full-motion export requires footage for every cinematic shot; generated title cards and maps are exempt. Missing or undecodable clips stop export with an actionable message.
- Export state is cleared even when preparation fails before encoding.
- GPU run references survive a cancelled wait or repeated status-service failures. Collect clips reconnects to the existing run. Long zero-progress waits show elapsed time instead of a repeating estimate.
- Separate IDs fix the selected-character button conflicting with photo consent.
- Service worker cache revision updated. Existing database schema and saved projects are unchanged.

Validation: generation-policy tests, JavaScript syntax checks, HTML ID/reference checks, desktop and 390px viewport review, and a real browser MP4 encoding/playback smoke test.

Backend boundary: this client uses the existing Vercel relay and Kaggle Wan/LatentSync worker. No Google Flow API connection or paid rendering service was added. The worker and relay source are not in this repository. Model quality, queue availability and exact character/voice consistency are not guaranteed by these frontend changes. A live five-shot generation test was started separately to inspect the existing worker.

Deploy only firebase-client using firebase.json to project voiceframe-6f5b3, Hosting site voiceframe-studio. Do not deploy .preview; it contains local QA fixtures and an authentication shim. Live security headers are preserved in firebase.json.
