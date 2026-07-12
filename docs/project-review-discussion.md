# HornyGrail Project Review

Discussion brief covering bugs, architecture improvements, simplification, and optimization opportunities.

## Executive Summary

The main project surfaces build successfully and the backend unit suite passes. The most important risks are security and consistency:

- The mobile app distributes a write credential inside the application bundle.
- The shared mobile access-code endpoint has no visible brute-force protection.
- Desktop uploads can publish metadata before all S3 assets are complete.

The remaining issues are primarily scalability, test reliability, and maintainability.

### Trust Model Decision

The mobile app is intended for the main user only and is treated as a trusted single-user client. Under this threat model, embedding the write key is an accepted tradeoff rather than a mandatory immediate remediation. The key remains extractable from the APK, so it should be rotated if the device or application package is exposed, or if the app is later shared with additional users.

## Triage Matrix

| Importance | Findings | Theme |
|---|---:|---|
| Accepted risk / security | 1 | Mobile write credential is recoverable from the APK under the trusted single-user model |
| High | 2-3 | Access-code brute force; unconditional metadata replacement |
| Medium | 4-7 | Scan truncation; desktop memory use; incomplete publication; stale frontend test |
| Low / architecture | 8-10 | Large mobile controller; noisy logs; missing stateful-client tests |

## Detailed Findings

### 1. ACCEPTED RISK / SECURITY - Mobile write credential is embedded in the application bundle

**Evidence:** The generated mobile configuration exports `writeApiKey`, and the mobile API sends it as `x-api-key` for write operations. Anyone who can inspect the APK can recover the shared key.

**Impact:** A copied key grants upload, metadata-write, integrity, and metadata-delete capabilities to whoever extracts it. This is acceptable while the app remains a trusted single-user client, but it is not suitable for a broadly distributed or multi-user app.

**Decision / suggested direction:** Keep the shared key for the current single-user deployment. Document the trusted-client assumption, restrict backend write operations as much as practical, and rotate the key if the device or APK is exposed. Replace it with authenticated, short-lived, capability-scoped tokens before sharing the app or adding multiple users.

References: [`privateConfig.js`](../local/mobile-app/src/lib/config/privateConfig.js:12), [`api.js`](../local/mobile-app/src/lib/mobile/api.js:137), [`prepare-private-config.mjs`](../local/mobile-app/scripts/prepare-private-config.mjs:16)

### 2. HIGH - The mobile access-code endpoint has no visible brute-force protection

**Evidence:** The endpoint directly compares a shared code and issues a bearer token. No route-level throttling, lockout, or attempt tracking is evident in the SAM configuration.

**Impact:** A leaked or guessed code enables read access and token issuance.

**Suggested direction:** Add API Gateway throttling or WAF controls, per-IP attempt limits, alerting, and preferably user/device authentication instead of a global code.

References: [`create-mobile-session.mjs`](../serverless/horny-grail-app/src/handlers/auth/create-mobile-session.mjs:14), [`template.yaml`](../serverless/horny-grail-app/template.yaml:521)

### 3. HIGH - Metadata writes unconditionally replace existing records - RESOLVED

**Evidence:** `put-item` uses `PutCommand` without a `ConditionExpression`, replacing `date`, `ext`, `status`, and `randomKey` for an existing hash.

**Impact:** Retries or concurrent uploads can change browse ordering, alter extension metadata, and leave old S3 objects behind.

**Resolution:** `POST /` now uses a conditional create. A repeated registration returns the existing record unchanged, and a repeated hash with a different extension is rejected. This preserves `date`, `randomKey`, `status`, and the original extension across retries.

Reference: [`put-item.mjs`](../serverless/horny-grail-app/src/handlers/put-item.mjs:45)

### 4. MEDIUM - All-items endpoints silently truncate at DynamoDB's 1 MB scan boundary - RESOLVED

**Evidence:** `scanAllItems` and the thumbnail scan issue one `ScanCommand` and ignore `LastEvaluatedKey`; the source comments acknowledge the limitation.

**Impact:** Once the table grows beyond 1 MB, callers receive incomplete collections without an error.

**Resolution:** Both scan-based endpoints now accept `limit` and opaque `cursor` query parameters and return `{ items, cursor }`. Limits are bounded to 1-100, invalid cursors are rejected, and `LastEvaluatedKey` is encoded into the next cursor. Existing callers that omit parameters receive the first page with the default limit.

References: [`items-repository.mjs`](../serverless/horny-grail-app/src/lib/items-repository.mjs:16), [`get-all-thumbnails.mjs`](../serverless/horny-grail-app/src/handlers/thumbnails/get-all-thumbnails.mjs:28)

### 5. MEDIUM - Desktop upload defeats the streaming-hash optimization - RESOLVED

**Evidence:** `uploadFile` rereads the complete file and hashes it with CryptoJS even though the desktop app has a streaming Rust hash command.

**Impact:** Large videos incur duplicate I/O and substantial JavaScript memory pressure.

**Resolution:** `uploadFile` now accepts the hash already computed by the desktop page and reuses it for registration. The file is still read once for the required S3 PUT, but the duplicate JavaScript hash calculation is avoided. A fallback hash remains for direct callers that do not provide one.

Reference: [`uploadFile.js`](../local/desktop-app/src/lib/functions/uploadFile.js:82)

### 6. MEDIUM - Desktop metadata becomes active before its thumbnail exists - RESOLVED

**Evidence:** The desktop flow registers metadata immediately after uploading the original; thumbnail upload happens later in the page controller.

**Impact:** A thumbnail failure exposes an incomplete item to browse/random queries until repair.

**Resolution:** New desktop uploads now perform original upload, thumbnail upload, then metadata registration. If thumbnail generation or upload fails, metadata is not published and the item remains retryable. Existing repair flows continue to use the idempotent registration behavior.

References: [`uploadFile.js`](../local/desktop-app/src/lib/functions/uploadFile.js:100), [`+page.svelte`](../local/desktop-app/src/routes/+page.svelte:419)

### 7. MEDIUM - The frontend test suite is checked in failing - RESOLVED

**Evidence:** The Playwright test still expects the starter SvelteKit heading `Welcome to SvelteKit`, while the page renders `THE HORNY GRAIL`.

**Impact:** CI cannot reliably signal regressions, and the current suite provides little coverage of browse/random behavior.

**Resolution:** Updated the Playwright smoke test to assert the current `h1.wordmark` product heading. Additional browse/random failure-path coverage remains a follow-up opportunity.

Reference: [`front/tests/test.js`](../front/tests/test.js:3)

### 8. LOW / ARCHITECTURE - The mobile home page is an oversized UI/controller module

**Evidence:** The route owns browse state, access handling, IndexedDB persistence, upload orchestration, cancellation, deletion, and presentation styling.

**Impact:** State transitions are difficult to reason about, and the most failure-prone behavior is hard to test independently.

**Suggested direction:** Extract browse and upload stores/controllers plus queue components, keeping the route responsible mainly for composition.

Reference: [`local/mobile-app/src/routes/+page.svelte`](../local/mobile-app/src/routes/+page.svelte:368)

### 9. LOW / ARCHITECTURE - Backend logging is excessive

**Evidence:** Several handlers log complete events, scan results, and serialized response bodies.

**Impact:** This increases CloudWatch cost and may expose request details or collection contents in logs.

**Suggested direction:** Log structured identifiers, counts, latency, and error codes; avoid full payloads except under controlled diagnostics.

References: [`get-all-items.mjs`](../serverless/horny-grail-app/src/handlers/get-all-items.mjs:19), [`get-by-id.mjs`](../serverless/horny-grail-app/src/handlers/get-by-id.mjs:21)

### 10. LOW / ARCHITECTURE - Tests are concentrated on Lambda handlers

**Evidence:** The backend has broad unit coverage, but there are no comparable automated tests for mobile recovery, desktop watcher races, thumbnail fallback, or queue cancellation.

**Impact:** Cross-client protocol regressions can pass all current tests.

**Suggested direction:** Add focused tests around upload state machines and watcher concurrency, using mocked API/S3/native boundaries.

## Verification Snapshot

- Backend: 40/40 Jest tests passed.
- Frontend: production build passed; Playwright failed on the stale heading assertion described above.
- Mobile: build/check passed.
- Desktop: Svelte check and Rust `cargo check` passed.
- Worktree: clean after review.

## Suggested Discussion Order

1. Reconfirm that the mobile app remains a trusted single-user client. If that changes, prioritize replacing the embedded write key.
2. Define the publication invariant: an item should be publicly queryable only when original, thumbnail, and metadata are complete.
3. Set a scale target for the DynamoDB table and retire or paginate scan-based APIs.
4. Agree on the minimum cross-client integration test suite before adding more features.
