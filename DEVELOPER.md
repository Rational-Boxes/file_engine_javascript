# FileEngine JS/TS Client — Developer Guide

A TypeScript/JavaScript client for the FileEngine gRPC service (`fileengine_rpc`
protocol, defined in `file_engine_core/proto/fileservice.proto`). It exposes a
filesystem-like API with UUID-identified entities and timestamp-string
versioning.

The Python client (`../python_interface`) exposes the **same operation set**
with equivalent behaviour; method names differ only by language convention
(`camelCase` here, `snake_case` there).

---

## Installation & build

```bash
npm install            # @grpc/grpc-js, @grpc/proto-loader, typescript
npm run build          # tsc -> dist/fileengine_grpc_client.js (+ .d.ts)
```

The TypeScript source `fileengine_grpc_client.ts` is the source of truth and is
fully typed (strict mode). `fileservice.proto` is bundled alongside it and is
resolved automatically at runtime (also when compiled into `dist/`).

```ts
import FileEngineClient from './dist/fileengine_grpc_client';
// or: const { FileEngineClient, ZERO_UID } = require('./dist/fileengine_grpc_client');
```

---

## Connecting & authentication

Authentication is a **trusted-upstream** model: the `userName`, `userRoles`,
`tenant`, and `userClaims` you pass are sent verbatim in every request. The
server enforces ACLs against them.

```ts
const client = new FileEngineClient({
  serverAddress: 'localhost:50051',
  userName: 'alice',
  userRoles: ['system_admin'],          // see "Administration" below
  tenant: 'default',                    // '' maps to the default tenant
  userClaims: ['read', 'write'],        // string[] | Record<string,string>
});
// ... use client ...
client.close();
```

A bare string is also accepted for backward compatibility:
`new FileEngineClient('localhost:50051')`.

### Administration is role-based

Privileged operations — **creating directly under the filesystem root** and all
**role/ACL administration** — require the `system_admin` *role*. There is no
special "root" user; include `system_admin` in `userRoles`.

### The filesystem root

The root may be referenced as the empty string `''` **or** the all-zeros UUID
`00000000-0000-0000-0000-000000000000` (exported as `ROOT_UID` / `ZERO_UID`).

---

## Quickstart

```ts
const client = new FileEngineClient({ userName: 'alice', userRoles: ['system_admin'] });

const workspace = await client.mkdir('', 'project');   // needs system_admin
const doc = await client.touch(workspace, 'notes.txt');
await client.put(doc, 'hello world');
console.log((await client.get(doc)).toString());        // "hello world"

for (const entry of await client.dir(workspace)) {      // DirectoryEntry[]
  console.log(entry.name, entry.isContainer, entry.size);
}
client.close();
```

Every method is `async`. Error convention: mutating calls resolve to `false` on
failure; getters resolve to `null` / `[]` / `{}`. Transport/RPC errors are
caught and surfaced the same way.

---

## Typed models

Exported TypeScript interfaces: `FileInfo`, `DirectoryEntry`, `Revision`,
`StorageUsage`, `AuthenticationContext`, and the string-literal unions
`FileTypeName`, `PermissionName`, `AclEffectName`.

| Interface | Key fields |
|-----------|-----------|
| `FileInfo` | `uid, name, parentUid, type, size, owner, permissions, createdAt, modifiedAt, version, isDir` |
| `DirectoryEntry` | `uid, name, type, size, createdAt, modifiedAt, versionCount, isContainer` |
| `Revision` | `version, name, user` |
| `StorageUsage` | `totalSpace, usedSpace, availableSpace, usagePercentage` |

`createdAt` / `modifiedAt` are `Date | null`.

---

## API reference

The acting identity defaults to the constructor values; `checkPermission` takes
optional `user`/`roles` overrides to evaluate a different principal.

### Filesystem
| Method | Resolves to | Notes |
|--------|-------------|-------|
| `mkdir(parentUid, name)` | `string \| false` | root parent needs `system_admin` |
| `touch(parentUid, name)` | `string \| false` | empty file |
| `put(uid, payload)` | `number \| false` | `Buffer` / `string` |
| `get(uid, back=0)` | `Buffer \| false` | `back` = versions back |
| `dir(uid, showDeleted=false)` | `DirectoryEntry[] \| false` | `showDeleted` → `ListDirectoryWithDeleted` |
| `listDeleted(uid)` | — | convenience |
| `exists(uid)` | `boolean` | |
| `stat(uid)` | `FileInfo \| null` | |
| `isDir(uid)` | `boolean` | |
| `getParent(uid)` | `string` | |
| `fileName(uid)` | `string[]` | |
| `getFileMtime(uid)` / `getFolderCdate(uid)` | `Date \| null` | |
| `rename(uid, newName)` | `boolean` | |
| `move(sourceUid, destinationUid, newName?)` | `boolean` | dest = new parent |
| `copy(sourceUid, destinationUid)` | `boolean` | recursive for dirs |
| `remove(uid)` | `boolean` | soft delete |
| `undeleteFile(uid)` | `boolean` | |

> Copying/moving a directory into itself or its own subtree is rejected by the
> server (resolves `false`) — it does not crash or recurse.

### Versioning
`revisions(uid)` → `Revision[]` (newest first);
`restoreToVersion(uid, versionTimestamp)` → `string | false`;
`purgeOldVersions(uid, keepCount)` → `boolean` (keeps the N most recent).

### Metadata
`setMetadataValue(uid, key, value)`, `getMetadataValue(uid, key)`,
`getMetadataValues(uid)` → object, `deleteMetadataValue(uid, key)`,
`getMetadataForVersion(uid, version, key)`,
`getAllMetadataForVersion(uid, version)` → object. Use `version='current'` for
the live version's metadata.

### Permissions / ACL
| Method | Notes |
|--------|-------|
| `checkPermission(resourceUid, permission, user?, roles?)` | evaluates the acting identity |
| `grantPermission(resourceUid, principal, permission, effect='ALLOW')` | needs `MANAGE_ACL` / `system_admin` |
| `revokePermission(resourceUid, principal, permission, effect='ALLOW')` | |

`permission` accepts an enum name (`'READ'`) or a single letter
(`r w x d l u v b s m i`). Prefix a `principal` with `role:` to target a role.
`effect` is `'ALLOW'` (default) or `'DENY'`; a matching DENY always wins.

### Roles
`createRole(role)`, `deleteRole(role)`, `assignUserToRole(targetUser, role)`,
`removeUserFromRole(targetUser, role)`, `getRolesForUser(targetUser)` → `string[]`,
`getUsersForRole(role)` → `string[]`, `getAllRoles()` → `string[]`. All require
`system_admin`.

### Administrative
`getStorageUsage()` → `StorageUsage | null`, `triggerSync()` → `boolean`.

---

## Testing

A live server is required for the integration suite:

```bash
npm test                       # builds, then runs test_client.js
node test_client.js host:50051 # point at a non-default server
```

`test_client.js` covers filesystem ops (incl. the subtree-copy guard),
root-UUID aliasing, versioning, metadata (incl. versioned), ACL r/w/x/d/m with
ALLOW/DENY precedence, role principals, and diagnostics — mirroring the Python
`test_integration_full.py` suite so both libraries stay equivalent.
