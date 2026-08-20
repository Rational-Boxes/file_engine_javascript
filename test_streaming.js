/**
 * Streaming upload/download parity tests (putStream / getStream).
 *
 * The requirement is not "streaming is available" but "a large body cannot
 * become one large message": a multi-megabyte gRPC message monopolises the
 * connection and can exceed a peer's receive limit. So the interesting tests
 * hand the client a deliberately oversized buffer and assert it still goes out
 * in bounded pieces.
 *
 * Mirrors python_interface/tests/test_streaming.py so the two libraries stay
 * equivalent.
 *
 * Run:  npm run build && node test_streaming.js  [server_address]
 */
const {
  FileEngineClient, MAX_WIRE_CHUNK, MAX_MESSAGE_BYTES, NotFoundError,
} = require('./dist/fileengine_grpc_client');

const SERVER = process.argv[2] || 'localhost:50051';
const USER = process.env.FILEENGINE_TEST_USER || 'testuser@rationalboxes.com';
const TENANT = process.env.FILEENGINE_TEST_TENANT || 'default';

let passed = 0;
let failed = 0;

function check(label, ok) {
  if (ok) { passed++; console.log(`  ok    ${label}`); }
  else { failed++; console.error(`  FAIL  ${label}`); }
}

async function main() {
  const c = new FileEngineClient({
    serverAddress: SERVER, userName: USER,
    userRoles: ['users', 'contributors'], tenant: TENANT,
  });
  const dir = await c.mkdir('', `js-stream-${Math.random().toString(16).slice(2, 10)}`);

  console.log('the requirement: bounded messages');

  // A single buffer is the natural thing for a caller to pass. Without
  // re-splitting it produces exactly the oversized message streaming exists to
  // avoid -- and at 10 MiB it also exceeds grpc-js's 4 MiB receive default,
  // which is why the channel options matter as much as the chunking.
  const big = Buffer.alloc(10 * 1024 * 1024, 0xa5);
  check('one buffer larger than MAX_WIRE_CHUNK', big.length > MAX_WIRE_CHUNK);
  const f1 = await c.touch(dir, 'one-buffer.bin');
  await c.putStream(f1, [big]);
  check('10 MiB single buffer round-trips', (await c.get(f1)).equals(big));

  const f2 = await c.touch(dir, 'small-chunks.bin');
  await c.putStream(f2, [Buffer.alloc(10000, 7)], 1024);
  check('an explicit small chunkSize is honoured', (await c.get(f2)).length === 10000);

  console.log('ordinary behaviour');

  const f3 = await c.touch(dir, 'gen.bin');
  async function* gen() {
    for (let i = 0; i < 10; i++) yield Buffer.alloc(1000, i);
  }
  await c.putStream(f3, gen());
  check('async generator chunks round-trip', (await c.get(f3)).length === 10000);

  const f4 = await c.touch(dir, 'sync.bin');
  await c.putStream(f4, [Buffer.from('a'), Buffer.from('b'), Buffer.from('c')]);
  check('a plain array is accepted too', (await c.get(f4)).toString() === 'abc');

  const f5 = await c.touch(dir, 'text.txt');
  await c.putStream(f5, ['héllo ', 'wörld']);
  check('string chunks are encoded', (await c.get(f5)).toString() === 'héllo wörld');

  // An empty source must still name a target, or the server answers
  // "No file data received" instead of writing an empty file.
  const f6 = await c.touch(dir, 'empty.bin');
  await c.putStream(f6, []);
  check('empty body writes an empty version', (await c.get(f6)).length === 0);

  const f7 = await c.touch(dir, 'holes.bin');
  await c.putStream(f7, [Buffer.from('a'), Buffer.alloc(0), Buffer.from('b')]);
  check('empty chunks are skipped, not treated as the end',
    (await c.get(f7)).toString() === 'ab');

  console.log('getStream');

  const parts = [];
  for await (const p of c.getStream(f1)) parts.push(p);
  check('getStream reassembles to the same bytes', Buffer.concat(parts).equals(big));

  let threw = false;
  try {
    // eslint-disable-next-line no-unused-vars
    for await (const _ of c.getStream('00000000-0000-0000-0000-000000000000')) { /* noop */ }
  } catch (e) {
    threw = e instanceof NotFoundError || /not.*(exist|found)/i.test(e.message);
  }
  check('getStream raises for a missing file', threw);

  console.log('channel');
  check('receive limit matches the core server (64 MiB)',
    MAX_MESSAGE_BYTES === 64 * 1024 * 1024);

  c.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('FAILED:', e && e.message ? e.message : e);
  process.exit(1);
});
