/**
 * Byte-range reads (storage_pipeline.md SR-10 – SR-14).
 *
 * Runs WITHOUT a server, against a fake gRPC client, and that is deliberate.
 * test_client.js and test_streaming.js need a reachable core and quietly do
 * nothing when there is not one — honest for an integration test, useless for a
 * contract like this, where what matters is what the client PUTS ON THE REQUEST
 * and what it does with the reply. A test that does not run proves nothing, and
 * the point of adding a range option is that callers can rely on it.
 *
 * Mirrors python_interface/tests/test_range_reads.py so the two libraries stay
 * equivalent.
 */
const assert = require('assert');
const { EventEmitter } = require('events');
const {
  FileEngineClient,
  InvalidRequestError,
} = require('./dist/fileengine_grpc_client');

let passed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed += 1; console.log(`  ok   ${name}`); })
    .catch((e) => { console.error(`  FAIL ${name}\n       ${e && e.message}`); process.exitCode = 1; });
}

/** One StreamFileDownload frame. */
function frame(data, extra = {}) {
  return Object.assign({
    data: data ? Buffer.from(data) : Buffer.alloc(0),
    success: true,
    error: '',
    total_size: 0,
    range_start: 0,
    range_length: 0,
    ranged: false,
    range_method: '',
  }, extra);
}

/** A client wired to a fake transport: no channel, no server. */
function client(frames, unary) {
  const recorded = { requests: [], getVersionCalls: 0 };
  const fake = {
    StreamFileDownload(request) {
      recorded.requests.push(request);
      const em = new EventEmitter();
      em.destroy = () => {};
      process.nextTick(() => {
        for (const f of (frames || [frame('whole')])) em.emit('data', f);
        em.emit('end');
      });
      return em;
    },
    GetFile(request, _md, cb) {
      recorded.requests.push(request);
      cb(null, unary || frame('unary', { total_size: 5 }));
    },
    GetVersion(request, _md, cb) {
      recorded.getVersionCalls += 1;
      recorded.requests.push(request);
      cb(null, frame('unary-version'));
    },
  };
  const c = Object.create(FileEngineClient.prototype);
  c.client = fake;
  c.auth = () => ({ user: 'tester@rationalboxes.com', tenant: 'default', roles: [], claims: {} });
  c.serviceMetadata = () => undefined;
  return { c, recorded };
}

async function collect(gen) {
  const out = [];
  for await (const v of gen) out.push(v);
  return out;
}

(async () => {
  console.log('range request fields');

  await test('an existing call still asks for the whole file', async () => {
    // SR-21: an untouched caller sends offset=0/length=0, which the server
    // reads as "everything". If this fails, the option broke every reader.
    const { c, recorded } = client();
    await c.get('uid-1');
    assert.strictEqual(recorded.requests[0].offset, 0);
    assert.strictEqual(recorded.requests[0].length, 0);
  });

  await test('existing positional arguments keep their meaning', async () => {
    // The range parameter was APPENDED, so `getStream(uid, version)` must still
    // mean what it meant.
    const { c, recorded } = client();
    await collect(c.getStream('uid-1', '20260929_120000.000'));
    assert.strictEqual(recorded.requests[0].version_timestamp, '20260929_120000.000');
    assert.strictEqual(recorded.requests[0].offset, 0);
  });

  await test('get sends the range', async () => {
    const { c, recorded } = client();
    await c.get('uid-1', 0, { offset: 5, length: 10 });
    assert.strictEqual(recorded.requests[0].offset, 5);
    assert.strictEqual(recorded.requests[0].length, 10);
  });

  await test('getStream sends the range', async () => {
    const { c, recorded } = client();
    await collect(c.getStream('uid-1', '', { offset: 7, length: 3 }));
    assert.strictEqual(recorded.requests[0].offset, 7);
    assert.strictEqual(recorded.requests[0].length, 3);
  });

  await test('length 0 means to the end', async () => {
    const { c, recorded } = client();
    await c.get('uid-1', 0, { offset: 64 });
    assert.strictEqual(recorded.requests[0].offset, 64);
    assert.strictEqual(recorded.requests[0].length, 0);
  });

  console.log('validation');

  await test('a negative offset is refused without an RPC', async () => {
    const { c, recorded } = client();
    await assert.rejects(() => c.get('uid-1', 0, { offset: -1 }),
      (e) => e instanceof InvalidRequestError);
    assert.strictEqual(recorded.requests.length, 0);
  });

  await test('a negative length is refused without an RPC', async () => {
    const { c, recorded } = client();
    await assert.rejects(() => collect(c.getStream('uid-1', '', { length: -5 })),
      (e) => e instanceof InvalidRequestError);
    assert.strictEqual(recorded.requests.length, 0);
  });

  await test('a non-integer offset is refused', async () => {
    const { c } = client();
    await assert.rejects(() => c.get('uid-1', 0, { offset: 1.5 }),
      (e) => e instanceof InvalidRequestError);
  });

  console.log('range metadata (SR-12: first frame only)');

  const metaFrames = () => [
    frame('abc', { total_size: 100, range_start: 5, range_length: 9, ranged: true, range_method: 'seek' }),
    frame('def'),  // zeros everywhere — must not overwrite
    frame('ghi'),
  ];

  await test('getRange reads the first frame and keeps it', async () => {
    const { c } = client(metaFrames());
    const r = await c.getRange('uid-1', { offset: 5, length: 9, version: 'v1' });
    assert.strictEqual(r.data.toString(), 'abcdefghi');
    assert.strictEqual(r.info.totalSize, 100);
    assert.strictEqual(r.info.rangeStart, 5);
    assert.strictEqual(r.info.rangeLength, 9);
    assert.strictEqual(r.info.ranged, true);
    assert.strictEqual(r.info.rangeMethod, 'seek');
  });

  await test('later frames do not clobber the metadata', async () => {
    // Reading metadata off every frame leaves totalSize at 0, and a door then
    // answers Content-Range with a length of nothing.
    const { c } = client(metaFrames());
    const r = await c.getRange('uid-1', { offset: 5, length: 9, version: 'v1' });
    assert.notStrictEqual(r.info.totalSize, 0);
  });

  await test('getRangeStream yields stable info with each chunk', async () => {
    const { c } = client(metaFrames());
    const pairs = await collect(c.getRangeStream('uid-1', { offset: 5, length: 9 }));
    assert.deepStrictEqual(pairs.map((p) => p.chunk.toString()), ['abc', 'def', 'ghi']);
    assert.ok(pairs.every((p) => p.info.totalSize === 100 && p.info.rangeMethod === 'seek'));
  });

  await test('a whole-file read reports not ranged', async () => {
    const { c } = client(null, frame('all', { total_size: 3, range_length: 3 }));
    const r = await c.getRange('uid-1');
    assert.strictEqual(r.info.ranged, false);
    assert.strictEqual(r.info.totalSize, 3);
  });

  await test('an old server reports no method rather than lying', async () => {
    // A core predating this leaves range_method empty. It must stay empty: a
    // caller trusting a fabricated 'seek' builds a scrubbing UI on an O(offset)
    // read.
    const { c } = client(null, frame('x'));
    const r = await c.getRange('uid-1');
    assert.strictEqual(r.info.rangeMethod, '');
  });

  console.log('ranged read of an older version');

  await test('a ranged read of a previous revision streams', async () => {
    const { c, recorded } = client([
      frame('old-slice', { total_size: 50, range_start: 2, range_length: 9, ranged: true }),
    ]);
    c.revisions = async () => ([{ version: '20260929_120000.000' }, { version: '20260928_120000.000' }]);
    const buf = await c.get('uid-1', 1, { offset: 2, length: 9 });
    assert.strictEqual(buf.toString(), 'old-slice');
    // GetVersion is unary and carries no range fields; using it here would
    // silently return the WHOLE version instead of the slice asked for.
    assert.strictEqual(recorded.getVersionCalls, 0);
    assert.strictEqual(recorded.requests[0].version_timestamp, '20260928_120000.000');
    assert.strictEqual(recorded.requests[0].offset, 2);
  });

  await test('an unranged read of a previous revision still uses GetVersion', async () => {
    const { c, recorded } = client();
    c.revisions = async () => ([{ version: '20260929_120000.000' }, { version: '20260928_120000.000' }]);
    await c.get('uid-1', 1);
    assert.strictEqual(recorded.getVersionCalls, 1);
  });

  console.log(`\n${passed} passed${process.exitCode ? ', with failures' : ''}`);
})();
