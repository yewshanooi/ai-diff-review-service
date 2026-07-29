// Quick test script for the AI Diff Review Service
const BASE = 'http://localhost:3000';
const TOKEN = 'test-token-123';

const testDiff = `--- a/test.js
+++ b/test.js
@@ -1,3 +1,7 @@
+const x = eval('code');
+console.log('debug');
+const key = api_key;
+if (x == null) { }
 const a = 1;
`;

async function main() {
  // 1. Health check
  console.log('=== 1. Health Check ===');
  const health = await fetch(`${BASE}/health`);
  console.log(await health.json());

  // 2. Spec
  console.log('\n=== 2. Spec ===');
  const spec = await fetch(`${BASE}/spec`);
  console.log(await spec.json());

  // 3. Auth failure (no token)
  console.log('\n=== 3. Auth Failure (no token) ===');
  const noAuth = await fetch(`${BASE}/v1/reviews`);
  console.log(noAuth.status, await noAuth.json());

  // 4. Submit a review
  console.log('\n=== 4. Submit Review ===');
  const submit = await fetch(`${BASE}/v1/reviews`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ diff: testDiff }),
  });
  const submitResult = await submit.json();
  console.log(submit.status, submitResult);

  const jobId = submitResult.jobId;

  // 5. Poll for results (wait a bit for processing)
  console.log('\n=== 5. Poll Job ===');
  await new Promise(r => setTimeout(r, 1000));
  const poll = await fetch(`${BASE}/v1/reviews/${jobId}`, {
    headers: { 'Authorization': `Bearer ${TOKEN}` },
  });
  const pollResult = await poll.json();
  console.log(JSON.stringify(pollResult, null, 2));

  // 6. Test SSE stream (replay on finished job)
  console.log('\n=== 6. SSE Stream Replay ===');
  const stream = await fetch(`${BASE}/v1/reviews/${jobId}/stream`, {
    headers: { 'Authorization': `Bearer ${TOKEN}` },
  });
  const streamText = await stream.text();
  console.log(streamText);

  // 7. Test caching (submit same diff again)
  console.log('\n=== 7. Cache Test (same diff) ===');
  const cached = await fetch(`${BASE}/v1/reviews`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ diff: testDiff }),
  });
  const cachedResult = await cached.json();
  const cachedJobId = cachedResult.jobId;
  await new Promise(r => setTimeout(r, 500));
  const cachedPoll = await fetch(`${BASE}/v1/reviews/${cachedJobId}`, {
    headers: { 'Authorization': `Bearer ${TOKEN}` },
  });
  const cachedPollResult = await cachedPoll.json();
  console.log('cacheHit:', cachedPollResult.usage?.cacheHit);

  // 8. Test idempotency
  console.log('\n=== 8. Idempotency Test ===');
  const body = JSON.stringify({ diff: testDiff });
  const idem1 = await fetch(`${BASE}/v1/reviews`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'test-key-1',
    },
    body,
  });
  const idem1Result = await idem1.json();
  console.log('First:', idem1Result);

  const idem2 = await fetch(`${BASE}/v1/reviews`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'test-key-1',
    },
    body,
  });
  const idem2Result = await idem2.json();
  console.log('Same key+body:', idem2Result);
  console.log('Same jobId?', idem1Result.jobId === idem2Result.jobId);

  // 9. Idempotency conflict
  console.log('\n=== 9. Idempotency Conflict ===');
  const conflict = await fetch(`${BASE}/v1/reviews`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'test-key-1',
    },
    body: JSON.stringify({ diff: testDiff + '\n+// different' }),
  });
  console.log(conflict.status, await conflict.json());

  // 10. Invalid diff
  console.log('\n=== 10. Invalid Diff ===');
  const invalid = await fetch(`${BASE}/v1/reviews`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ diff: 'not a diff' }),
  });
  console.log(invalid.status, await invalid.json());

  // 11. Not found
  console.log('\n=== 11. Not Found ===');
  const notFound = await fetch(`${BASE}/v1/reviews/nonexistent`, {
    headers: { 'Authorization': `Bearer ${TOKEN}` },
  });
  console.log(notFound.status, await notFound.json());

  console.log('\n=== All tests complete ===');
}

main().catch(console.error);
