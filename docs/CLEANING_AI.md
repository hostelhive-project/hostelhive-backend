# Groq cleaning photo assessment

## Setup

- Set the existing server-only `GROQ_API_KEY` in the backend `.env`. Never add it to the web or mobile environment.
- Defaults: `CLEANING_AI_ENABLED=true`, `GROQ_VISION_MODEL=qwen/qwen3.8-27b`, `CLEANING_AI_DAILY_LIMIT=20`. The existing chatbot keeps its own `GROQ_MODEL`.
- Use a Groq **Free** account/project. HostelHive cannot inspect or override provider billing settings. There is no paid provider fallback.
- Requires registered ImageKit `/cleaning` uploads and the transaction-capable MongoDB already required by other workflows. No migration/backfill of old tasks is needed.
- Restart the backend after changing environment configuration. Its normal server starts the existing outbox worker.

## Workflow

1. Staff uploads a before photo and starts the assigned task using the existing app.
2. Staff uploads an after photo and completes it. Completion and an idempotent `CleaningAssessment` outbox event commit in one transaction; no image download or AI request delays this response.
3. The worker validates both photos against the upload registry, assigned account, configured ImageKit origin and `/cleaning/` path. Private files, arbitrary URLs, redirects, unsupported formats and images over 5 MB are excluded. Repeated photos can receive an appearance rating, with an explicit warning that repeated evidence cannot verify completed work.
4. Valid image bytes are sent to Groq with explicit BEFORE/AFTER labels and a fixed prompt. Staff names, room numbers, notes, identity documents and chat history are not added to the request. Photos can still inadvertently contain personal information: capture without faces/documents. Model detection is best effort, not a pre-upload privacy filter.
5. The server validates the JSON response and computes the score. The result is stored on `CleaningTask.cleaningAssessment`; ordinary authorized task endpoints return it.
6. Admin opens **Cleaning Schedule → View details → AI cleaning assessment**. Completed rows show a score/status badge. Pending lists and open details refresh automatically; the panel also has Refresh.

The Staff photo section explains the photo requirements and third-party processing. Existing task routes, status values, upload fields and permissions remain unchanged. There is no public scoring endpoint or client-supplied score.

## Rubric

| Criterion | Maximum | Meaning |
| --- | --- | --- |
| Visible litter | 3 | Less visible litter earns more points. |
| Floor | 3 | Less visible dust, debris and spills earns more points. |
| Relevant surfaces | 3 | Cleaner visible fixtures/furniture/sanitary surfaces earns more points. |
| Tidiness | 1 | Visible area is orderly and accessible. |

Current policy: **cleaning-v2**, introduced on 6 November 2026 at the user's request. Every recognizable cleaning area receives an **estimated rating out of 10**, including photos with blur, low resolution, different framing or incomplete coverage. Change from before is reported separately. Different areas can still receive an AFTER-appearance rating, but their change comparison is Unclear.

Each visible criterion receives whole-number points; a criterion outside the frame is `null`, not zero. The server computes `round(sum(points) / sum(maximums for visible criteria) * 10, 1)`. For example, a visible floor rated 2/3, with other criteria out of frame, receives an estimated **6.7/10**, with **30% visible rubric coverage**. Coverage describes the rubric included in the calculation, not statistically calibrated confidence. The panel labels estimates, photo-quality limitations and criteria that were not visible. Zero remains a valid score for visible poor cleanliness.

An already clean room is not automatically penalized for little change. Completely blank, unrelated or unreadable images with no recognizable cleaning area are unavailable. Retrieval, invalid-response, configuration and provider failures also remain errors rather than invented cleanliness scores. These are subjective visual estimates, not validated hygiene measurements or staff-performance scores. The administrator makes the final decision; no automatic work acceptance, pay decisions or complaint resolution is performed.

## States and cost controls

- `Pending` → `Processing` → `Assessed` or `Unavailable`. Current processing does not produce a ManualReview outcome; the schema can still read that legacy value.
- Recognizable photo evidence produces a numeric estimate. Blur, missing criteria, different angles and duplicate photos no longer suppress the whole rating. Old tasks with no requested assessment show **Not assessed**.
- Missing key, disabled feature, exhausted allowance, invalid model/response or failed attempts produce unavailable; staff completion remains saved.
- A persistent global UTC-day budget permits at most **20 requests/day**, including failed calls and retries, across all hostels and worker instances. `CLEANING_AI_DAILY_LIMIT` can lower this to 0–20; invalid values fail closed to zero.
- Requests are spaced at least **65 seconds** apart. Each task permits at most **2 provider attempts**; only temporary network/429/5xx failures retry once. Worker crashes can consume an attempt without a result; the cap remains conservative.
- Requests time out after 30 seconds; downloads after 10 seconds each. Pending work older than 30 minutes becomes unavailable. No unlimited automatic backfill or retry endpoint exists.
- Budget documents expire after 35 days. Their counters and next-allowed time are operational metadata, not image content. Images/base64 and raw provider errors are not stored in these documents or logs.

Provider limits also cover other users of the same organization and may be lower. Application caps do not guarantee a paid provider account has no charges. Current model availability and free limits must be checked in your Groq console.

Official references checked 6 November 2026: [Groq Vision](https://console.groq.com/docs/vision), [Qwen 3.8](https://console.groq.com/docs/model/qwen/qwen3.8-27b), [rate limits](https://console.groq.com/docs/rate-limits), [data processing](https://console.groq.com/docs/your-data).

## Verification

Maintained coverage: `tests/cleaningAssessment.test.js` (full/partial numeric ratings, zero scores, limitations, repeated photos, bounded retries, photo validation and provider request contract), plus `tests/cleaningTask.test.js` (completion/outbox persistence, duplicate completion, quota concurrency and stale-claim protection). Tests isolate their database and mock external AI requests. Version 2 passed **66 focused tests**, backend lint and web TypeScript compilation.

Initial version checks (6 November 2026): 60 focused tests passed, including persistence of a computed score and its breakdown through the real MongoDB repository with a mocked provider response. Those initial checks did not send actual staff photos. Version 2 additionally requeued three identified version-1 assessments rejected for insufficient evidence, preserving provider attempt counters and the global request budget. No browser/device visual walkthrough was performed.

Live version-2 verification (6 November 2026): all three requeued tasks finished as Assessed with numeric ratings **7/10**, **5/10** and **10/10**. The first two retained Limited photo-quality warnings; the third reported Good quality. The saved records use cleaning-v2 and two lifetime provider attempts each. The real provider calls used the existing outbox, request spacing and budget.
