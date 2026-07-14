# Follow-ups (deliberately deferred)

The `fix/review-hardening` branch fixed all reviewed defects (security S1–S6, correctness
B1–B7) and added the low-risk, high-value improvements: a deterministic crisis-safety card,
CSP + security headers, a CI pipeline, and a data-export endpoint.

The items below were **intentionally not** done in that pass — they are larger, more
opinionated, or carry deployment risk, and deserve their own design/review cycle.

## Security / privacy
- **Rotate the Cloudflare API token.** `.env` holds a plaintext `CLOUDFLARE_API_TOKEN`
  (gitignored, never committed, so not leaked). Still: rotate it and move it out of the
  working tree — prefer a scoped token in your shell/CI secret store, not a file on disk.
- **Encrypt free-text notes at rest + GDPR controls.** Notes are sensitive health data.
  Consider envelope encryption for `entries.note` / `chat_turns.content`, plus explicit
  data-retention and delete-my-account flows (export already shipped).
- **Rate-limit the AI endpoints.** Deliberately skipped: the app is single-user behind
  Access MFA, and a naive KV limiter risks throttling the legitimate sole user for little
  gain once S1/S2 (the workers.dev + dev-fallback bypasses) are closed. Revisit if the
  Access policy is ever broadened.

## AI quality
- **Ground the AI in deterministic analytics.** Today the insight job and chat dump raw
  JSON and ask Llama to "spot patterns" — LLMs miscompute averages/trends. Add a small
  stats module (rolling means, day-of-week effects, metric correlations, sleep→mood lag)
  and feed it computed numbers.
- **Streaming fallback is pre-stream only.** `ai.ts` only retries the fallback model if the
  primary throws *before* streaming starts; a mid-stream failure isn't recovered. Buffering
  or a sentinel-based retry would fix it.
- **Chat "ask about this day"** + inject today's entry + computed stats into chat context.

## Product / UX
- Installable PWA + offline app shell; offline save queue.
- Weekly digest, and move insight generation from per-PUT `ctx.waitUntil` to a scheduled
  **Cron Trigger** (cheaper, more reliable, decoupled from the save latency path).
- Backfill missed days from History; surface notes in the History timeline.
- Accessibility: roving `tabindex` + arrow-key selection on the emoji rows; honour
  `prefers-reduced-motion`.

## Developer experience
- Replace the hand-rolled Web-Crypto JWT verifier with a vetted library (`jose`).
- Add ESLint + Prettier and wire them into CI.
- Bump the toolchain (wrangler v4, vitest 3 + matching `vitest-pool-workers`) — needs its
  own migration + green-test verification.
- Single-source the D1 column lists / typed row mapping to stop schema-vs-type drift.
- Add a real end-to-end test through the Worker via the `SELF` fetch binding.
