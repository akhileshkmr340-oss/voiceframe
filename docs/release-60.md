# Clip continuity and quality review repair

The production test returned four generated clips and one rejected clip. Existing checks ran after acceptance, could overwrite one another's findings, and did not gate full-motion export on motion/cast quality.

Changes:
- Persist independent cast, motion and technical results. Check cast at 20%, 50% and 80% of generated clips; await results and bound stalled checks.
- Gate full-motion export while checks are pending or quality findings require review. A person may explicitly Keep a reviewed quality finding; missing footage and safety rejection cannot be overridden by this action.
- Retry only missing or flagged shots, preserving completed clips and using the original reference picture instead of repeatedly feeding a flawed generated frame back into the model.
- Include wardrobe/identity constraints in motion prompts. Plan one primary body action per short shot to reduce overloaded movements.
- Send all dialogue segments for a single speaker to lip-sync. Explicitly reject multi-speaker shots or speech longer than the model's clip capacity rather than silently dropping lines.
- Bound video-frame decode/seek waits, surface unavailable motion checks, release decoders, and prevent changing projects during an active job.

Validation: Node regressions include concurrent check findings, pending/failed quality review, legacy warnings, minimal retry selection, single-speaker enforcement, timeout/cancellation and existing export/import cases. Visual quality and worker latency still require a new live generation test.

Deployment status: source repair prepared; not yet deployed. Vercel relay source/log access returned 403 requiring a project-team consent grant. The relay/GPU worker has not been modified, no alternate paid provider has been configured, and no guarantee of Google Flow parity is made.
