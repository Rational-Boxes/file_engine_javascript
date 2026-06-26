/**
 * Full integration test for the FileEngine JS/TS client against a RUNNING
 * server (default localhost:50051). Mirrors the Python test_integration_full
 * suite so the two libraries stay equivalent.
 *
 * Administration is role-based: the client authenticates with the
 * `system_admin` role (the username itself is not special).
 *
 * Run:  node test_client.js  [server_address]
 */
const { FileEngineClient, ZERO_UID } = require('./dist/fileengine_grpc_client');

const SERVER = process.argv[2] || 'localhost:50051';
let pass = 0, fail = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + msg); }
  else { fail++; failures.push(msg); console.log('  \x1b[31m✗\x1b[0m ' + msg); }
}

async function main() {
  const admin = new FileEngineClient({
    serverAddress: SERVER, userName: 'admin_user',
    userRoles: ['system_admin'], tenant: 'default',
  });

  const suf = `${Date.now()}`;
  console.log(`FileEngine JS client integration test  server=${SERVER}`);

  // [0] connectivity + root aliasing
  console.log('[0] Connectivity / root aliasing');
  const su = await admin.getStorageUsage();
  ok(su && su.totalSpace > 0, 'storage usage (typed)');
  const rootA = await admin.dir('');
  const rootB = await admin.dir(ZERO_UID);
  ok(Array.isArray(rootA) && Array.isArray(rootB) && rootA.length === rootB.length, 'root aliases list identically');

  const ws = await admin.mkdir('', `jsit_${suf}`);
  ok(Boolean(ws), `mkdir workspace (system_admin) -> ${ws}`);
  const zdir = await admin.mkdir(ZERO_UID, `jsit_zero_${suf}`);
  ok(Boolean(zdir), 'mkdir via all-zeros root');
  ok((await admin.dir('')).some(e => e.name === `jsit_zero_${suf}`), 'zero-root dir visible at root');

  // [1] filesystem
  console.log('[1] Filesystem');
  const f = await admin.touch(ws, 'hello.txt');
  ok(Boolean(f), `touch -> ${f}`);
  ok((await admin.put(f, 'hello v1')) !== false, 'put v1');
  ok((await admin.put(f, Buffer.from('hello v2'))) !== false, 'put v2');
  const got = await admin.get(f);
  ok(got && got.toString() === 'hello v2', 'get latest == v2');
  ok(await admin.exists(f), 'exists file');
  ok(!(await admin.exists('deadbeef-0000-0000-0000-000000000000')), 'exists false for bogus uid');
  ok((await admin.stat(ws)).isDir === true, 'stat dir isDir true');
  ok((await admin.stat(f)).isDir === false, 'stat file isDir false');
  ok((await admin.getParent(f)) === ws, 'getParent == workspace');
  ok(await admin.rename(f, 'renamed.txt'), 'rename');
  ok((await admin.stat(f)).name === 'renamed.txt', 'stat shows renamed');

  const sub = await admin.mkdir(ws, 'sub');
  const sub2 = await admin.mkdir(ws, 'sub2');
  ok(await admin.copy(f, sub), 'copy file to sub');
  ok((await admin.dir(sub)).some(e => e.name === 'renamed.txt'), 'copied file in sub');
  ok(await admin.move(f, sub2), 'move file to sub2');
  ok((await admin.getParent(f)) === sub2, 'moved file parent == sub2');

  // subtree guard
  const guard = await admin.mkdir(ws, 'guard');
  const gchild = await admin.mkdir(guard, 'child');
  ok((await admin.copy(guard, gchild)) === false, 'copy dir into own subtree rejected');
  ok((await admin.move(guard, gchild)) === false, 'move dir into own subtree rejected');
  ok((await admin.getStorageUsage()) !== null, 'server alive after guard');

  // recursive dir copy
  const rcsrc = await admin.mkdir(ws, 'rcsrc');
  const inner = await admin.touch(rcsrc, 'inner.txt');
  await admin.put(inner, 'inner');
  const rcdst = await admin.mkdir(ws, 'rcdst');
  ok(await admin.copy(rcsrc, rcdst), 'recursive dir copy');
  const copiedDir = (await admin.dir(rcdst)).find(e => e.name === 'rcsrc');
  ok(copiedDir && (await admin.dir(copiedDir.uid)).some(e => e.name === 'inner.txt'), 'recursive copy preserved contents');

  // soft delete / lsd / undelete
  const delbox = await admin.mkdir(ws, 'delbox');
  const gone = await admin.touch(delbox, 'gone.txt');
  await admin.put(gone, 'bye');
  ok(await admin.remove(gone), 'soft delete file');
  ok(!(await admin.dir(delbox)).some(e => e.name === 'gone.txt'), 'ls hides deleted');
  ok((await admin.listDeleted(delbox)).some(e => e.name === 'gone.txt'), 'lsd shows deleted');
  ok(await admin.undeleteFile(gone), 'undelete');
  ok((await admin.dir(delbox)).some(e => e.name === 'gone.txt'), 'ls shows undeleted');

  // [2] versioning
  console.log('[2] Versioning');
  const vf = await admin.touch(ws, 'ver.txt');
  await admin.put(vf, 'v1');
  await new Promise(r => setTimeout(r, 1100)); await admin.put(vf, 'v2');
  await new Promise(r => setTimeout(r, 1100)); await admin.put(vf, 'v3');
  const revs = await admin.revisions(vf);
  ok(revs.length >= 3, `revisions (${revs.length})`);
  ok((await admin.get(vf, 1)).toString() === 'v2', 'get one back == v2');
  ok((await admin.restoreToVersion(vf, revs[1].version)) !== false, 'restore to version');
  ok(await admin.purgeOldVersions(vf, 1), 'purge keep 1');
  ok((await admin.revisions(vf)).length <= 1, 'purge trimmed versions');

  // [3] metadata
  console.log('[3] Metadata');
  const mf = await admin.touch(ws, 'meta.txt'); await admin.put(mf, 'm');
  ok(await admin.setMetadataValue(mf, 'color', 'blue'), 'setMetadata');
  ok((await admin.getMetadataValue(mf, 'color')) === 'blue', 'getMetadata == blue');
  ok((await admin.getMetadataValues(mf)).color === 'blue', 'getAllMetadata');
  ok((await admin.getAllMetadataForVersion(mf, 'current')).color === 'blue', 'allMetadataForVersion current');
  ok((await admin.getMetadataForVersion(mf, 'current', 'color')) === 'blue', 'metadataForVersion current');
  ok(await admin.deleteMetadataValue(mf, 'color'), 'deleteMetadata');
  ok((await admin.getMetadataValue(mf, 'color')) === null, 'metadata removed');

  // [4] permissions / ACL
  console.log('[4] Permissions / ACL');
  const af = await admin.touch(ws, 'acl.txt'); await admin.put(af, 'a');
  for (const letter of ['r', 'w', 'x', 'd', 'm']) {
    ok(await admin.grantPermission(af, 'dave', letter), `grant ${letter} to dave`);
    ok(await admin.checkPermission(af, letter, 'dave', []), `dave has ${letter}`);
  }
  await admin.grantPermission(af, 'erin', 'r');
  await admin.grantPermission(af, 'erin', 'r', 'deny');
  ok((await admin.checkPermission(af, 'r', 'erin', [])) === false, 'DENY overrides ALLOW');
  await admin.revokePermission(af, 'erin', 'r', 'deny');
  ok((await admin.checkPermission(af, 'r', 'erin', [])) === true, 'access restored after deny-revoke');

  // effective permission set (one call; for indexer-style consumers)
  await admin.grantPermission(af, 'frank', 'r');
  await admin.grantPermission(af, 'frank', 'w');
  const effFrank = await admin.getEffectivePermissions(af, 'frank', []);
  ok(effFrank.includes('READ') && effFrank.includes('WRITE'), 'effective set includes granted perms');
  ok(!effFrank.includes('DELETE'), 'effective set excludes ungranted perms');
  const effNobody = await admin.getEffectivePermissions(af, 'nobody', []);
  ok(!effNobody.includes('WRITE'), 'effective set empty-ish for principal with no grants');

  // claim-based (ABAC) rules: grant to "claim:key=value", decision follows the
  // requester's auth claims rather than user/roles.
  const cf = await admin.touch(ws, 'claim.txt'); await admin.put(cf, 'c');
  await admin.grantPermission(cf, 'claim:department=engineering', 'r');
  await admin.grantPermission(cf, 'claim:department=engineering', 'w');
  const eng = { department: 'engineering' };
  ok(await admin.checkPermission(cf, 'r', 'ivy', [], eng), 'matching claim grants READ');
  const effEng = await admin.getEffectivePermissions(cf, 'ivy', [], eng);
  ok(effEng.includes('READ') && effEng.includes('WRITE'), 'claim effective set includes granted perms');
  // READ is granted to everyone by the read-by-default baseline, so the claim's
  // effect is witnessed by WRITE rather than READ for the negative cases.
  ok((await admin.checkPermission(cf, 'w', 'ivy', [], { department: 'sales' })) === false, 'non-matching claim value denied (no WRITE)');
  ok((await admin.checkPermission(cf, 'w', 'ivy', [], {})) === false, 'absent claim denied (no WRITE)');
  await admin.grantPermission(cf, 'claim:status=quarantined', 'r', 'deny');
  ok((await admin.checkPermission(cf, 'r', 'ivy', [], { department: 'engineering', status: 'quarantined' })) === false, 'matching DENY claim overrides ALLOW');

  // [5] roles
  console.log('[5] Role management');
  const role = `editors_${suf}`;
  ok(await admin.createRole(role), 'createRole');
  ok((await admin.getAllRoles()).includes(role), 'getAllRoles shows role');
  ok(await admin.assignUserToRole('carol', role), 'assignUserToRole');
  ok((await admin.getRolesForUser('carol')).includes(role), 'getRolesForUser');
  ok((await admin.getUsersForRole(role)).includes('carol'), 'getUsersForRole');
  ok(await admin.grantPermission(af, `role:${role}`, 'r'), 'grant READ to role');
  ok(await admin.checkPermission(af, 'r', 'carol', [role]), 'carol(role) has READ');
  ok(await admin.removeUserFromRole('carol', role), 'removeUserFromRole');
  ok(!(await admin.getRolesForUser('carol')).includes(role), 'remove took effect');
  ok(await admin.deleteRole(role), 'deleteRole');

  // [6] diagnostics
  console.log('[6] Diagnostics');
  ok(await admin.triggerSync(), 'triggerSync');

  // cleanup
  await admin.remove(ws);
  await admin.remove(zdir);
  admin.close();

  console.log('==========================================================');
  console.log(` RESULTS:  PASS=${pass}  FAIL=${fail}`);
  if (fail) { console.log(' Failed:'); failures.forEach(m => console.log('   - ' + m)); }
  console.log('==========================================================');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL', e); process.exit(2); });
