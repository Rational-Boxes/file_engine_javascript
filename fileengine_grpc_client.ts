/**
 * FileEngine gRPC client (TypeScript).
 *
 * Targets the canonical `fileengine_rpc` protocol defined in
 * `file_engine_core/proto/fileservice.proto`. Exposes a filesystem-like API
 * equivalent to the Python `ManagedFiles` client.
 *
 * Administration is role-based: pass the `system_admin` role to authorize
 * root-level creation and ACL/role management. The filesystem root may be
 * referenced as the empty string `""` or the all-zeros UUID.
 *
 * On failure, methods THROW a typed {@link FileEngineError} subclass (see
 * `errors.ts`) carrying the operation, target uid, and server message — rather
 * than returning a falsy value. In particular, write operations throw
 * {@link WriteUnavailableError} while the server is temporarily read-only during
 * a primary-database failover; that error's `transient` flag is `true`, so the
 * caller may retry once the primary recovers.
 */
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';
import * as fs from 'fs';
import { raiseRpc, checkResponse, NotFoundError } from './errors';

export const ROOT_UID = '';
export const ZERO_UID = '00000000-0000-0000-0000-000000000000';

export {
  FileEngineError,
  ServerUnreachableError,
  ServiceUnavailableError,
  WriteUnavailableError,
  AuthenticationError,
  PermissionDeniedError,
  NotFoundError,
  AlreadyExistsError,
  InvalidRequestError,
  OperationError,
} from './errors';

// ----------------------------- typed models ------------------------------ //
export type FileTypeName = 'REGULAR_FILE' | 'DIRECTORY' | 'SYMLINK';
export type PermissionName =
  | 'READ' | 'WRITE' | 'DELETE' | 'LIST_DELETED' | 'UNDELETE' | 'VIEW_VERSIONS'
  | 'RETRIEVE_BACK_VERSION' | 'RESTORE_TO_VERSION' | 'EXECUTE' | 'MANAGE_ACL'
  | 'ACL_INHERIT';
export type AclEffectName = 'ALLOW' | 'DENY';

export interface AuthenticationContext {
  user: string;
  roles: string[];
  tenant: string;
  claims: { [key: string]: string };
}

export interface FileInfo {
  uid: string;
  name: string;
  parentUid: string;
  type: FileTypeName;
  size: number;
  owner: string;
  permissions: number;
  createdAt: Date | null;
  modifiedAt: Date | null;
  version: string;
  isDir: boolean;
  /** Hidden child renditions (alternate formats); files only, 0 for dirs. */
  renditionCount: number;
  /** True if this file has hidden renditions. */
  hasRenditions: boolean;
}

export interface DirectoryEntry {
  uid: string;
  name: string;
  type: FileTypeName;
  size: number;
  createdAt: Date | null;
  modifiedAt: Date | null;
  versionCount: number;
  isContainer: boolean;
  /** Hidden child renditions (alternate formats); files only, 0 for dirs. */
  renditionCount: number;
  /** True if this file entry has hidden renditions. */
  hasRenditions: boolean;
  /** Soft-deleted; only ever true in a with-deleted listing (dir(uid, true) / listDeleted). */
  deleted: boolean;
  /** Owning user (from the metadata DB). */
  owner: string;
  /** Creator = first revision author (falls back to owner). */
  createdBy: string;
  /** Latest reviser = last revision author (falls back to owner). */
  modifiedBy: string;
}

export interface Revision {
  version: string;
  name: string;
  /**
   * Who uploaded THIS version, as recorded by the core.
   *
   * This used to be filled with the *calling* user, so every version appeared to
   * have been uploaded by whoever was listing them — a confident wrong answer.
   * Empty when the core has no record for that version.
   */
  user: string;
}

export interface StorageUsage {
  totalSpace: number;
  usedSpace: number;
  availableSpace: number;
  usagePercentage: number;
}

export interface ClientOptions {
  serverAddress?: string;
  userName?: string;
  userRoles?: string[];
  tenant?: string;
  userClaims?: string[] | { [key: string]: string };
}

const PERM_LETTERS: { [k: string]: PermissionName } = {
  r: 'READ', w: 'WRITE', x: 'EXECUTE', d: 'DELETE', l: 'LIST_DELETED',
  u: 'UNDELETE', v: 'VIEW_VERSIONS', b: 'RETRIEVE_BACK_VERSION',
  s: 'RESTORE_TO_VERSION', m: 'MANAGE_ACL', i: 'ACL_INHERIT',
};

function coercePermission(p: PermissionName | string): string {
  if (p.length === 1 && PERM_LETTERS[p.toLowerCase()]) return PERM_LETTERS[p.toLowerCase()];
  return p.toUpperCase();
}

function coerceEffect(e: AclEffectName | string): string {
  return String(e).toUpperCase() === 'DENY' ? 'DENY' : 'ALLOW';
}

/** Convert a server epoch-seconds value to a Date, tolerating the
 *  out-of-range / wrong-unit values some entries carry. Returns null if the
 *  value cannot be interpreted as a sane timestamp. */
function safeDate(ts: number | string | undefined | null): Date | null {
  const n = typeof ts === 'string' ? Number(ts) : ts;
  if (!n || !isFinite(n)) return null;
  for (const div of [1, 1e3, 1e6, 1e9]) {
    const d = new Date((n / div) * 1000);
    const year = d.getUTCFullYear();
    if (year >= 1970 && year <= 9999) return d;
  }
  return null;
}

function resolveProtoPath(): string {
  const candidates = [
    path.join(__dirname, 'fileservice.proto'),        // bundled alongside source
    path.join(__dirname, '..', 'fileservice.proto'),  // when compiled into dist/
    path.join(__dirname, '..', '..', 'file_engine_core', 'proto', 'fileservice.proto'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

const packageDefinition = protoLoader.loadSync(resolveProtoPath(), {
  keepCase: true,
  longs: Number,
  enums: String,
  defaults: true,
  oneofs: true,
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const proto: any = grpc.loadPackageDefinition(packageDefinition).fileengine_rpc;

/** Largest gRPC message either direction. Matches the core server and the
 *  Python client so no peer is the odd one out. */
export const MAX_MESSAGE_BYTES = 64 * 1024 * 1024;

/** Largest body chunk placed in a single message. Bounded on purpose: a
 *  multi-megabyte message monopolises the connection, so content moves as a
 *  series of small messages rather than one large one. */
export const MAX_WIRE_CHUNK = 4 * 1024 * 1024;

/**
 * High-level FileEngine client, equivalent to the Python `ManagedFiles`.
 * Stores a default user/roles/tenant/claims used for every call (overridable
 * per call). Methods resolve to friendly values (uid string, Buffer, typed
 * models) and THROW a {@link FileEngineError} subclass on failure.
 */
export class FileEngineClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;
  private user: string;
  private roles: string[];
  private tenant: string;
  private claims: { [key: string]: string };

  constructor(options: ClientOptions | string = {}) {
    const opts: ClientOptions = typeof options === 'string' ? { serverAddress: options } : options;
    this.user = opts.userName || 'user';
    this.roles = opts.userRoles || [];
    this.tenant = opts.tenant ?? '';
    this.claims = {};
    if (Array.isArray(opts.userClaims)) {
      for (const c of opts.userClaims) this.claims[c] = c;
    } else if (opts.userClaims) {
      this.claims = { ...opts.userClaims };
    }
    this.client = new proto.FileService(
      opts.serverAddress || 'localhost:50051',
      grpc.credentials.createInsecure(),
      {
        // grpc-js defaults to a 4 MiB RECEIVE limit, which is far below what
        // this platform stores and below what the core is willing to send
        // (server.cpp sets 64 MiB both ways). Left unset, a client could store
        // a file it was then unable to read back. Matched to the server, and to
        // the Python client, so all three agree on the ceiling.
        'grpc.max_receive_message_length': MAX_MESSAGE_BYTES,
        'grpc.max_send_message_length': MAX_MESSAGE_BYTES,
      },
    );
  }

  close(): void {
    grpc.closeClient(this.client);
  }

  setUserInformation(userName?: string, roles?: string[], claims?: string[]): void {
    if (userName) this.user = userName;
    if (roles) this.roles = roles;
    if (claims) { this.claims = {}; for (const c of claims) this.claims[c] = c; }
  }

  private auth(user?: string, roles?: string[], tenant?: string, claims?: { [k: string]: string }): AuthenticationContext {
    return {
      user: user || this.user,
      roles: roles || this.roles,
      tenant: tenant ?? this.tenant,
      claims: claims || this.claims,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private call<TRes = any>(method: string, request: object): Promise<TRes> {
    return new Promise<TRes>((resolve, reject) => {
      this.client[method](request, (err: grpc.ServiceError | null, response: TRes) => {
        if (err) reject(err); else resolve(response);
      });
    });
  }

  // --------------------------- directory ops --------------------------- //
  async mkdir(parentUid: string, name: string): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r: any;
    try { r = await this.call('MakeDirectory', { parent_uid: parentUid, name, auth: this.auth() }); }
    catch (e) { raiseRpc(e as grpc.ServiceError, 'mkdir', parentUid); }
    checkResponse(r, 'mkdir', parentUid);
    return r.uid;
  }

  async dir(uid: string, showDeleted = false): Promise<DirectoryEntry[]> {
    const method = showDeleted ? 'ListDirectoryWithDeleted' : 'ListDirectory';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r: any;
    try { r = await this.call(method, { uid, auth: this.auth() }); }
    catch (e) { raiseRpc(e as grpc.ServiceError, 'dir', uid); }
    checkResponse(r, 'dir', uid, NotFoundError);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (r.entries || []).map((e: any): DirectoryEntry => ({
      uid: e.uid,
      name: e.name,
      type: e.type as FileTypeName,
      size: Number(e.size) || 0,
      createdAt: safeDate(e.created_at),
      modifiedAt: safeDate(e.modified_at),
      versionCount: Number(e.version_count) || 0,
      isContainer: e.type === 'DIRECTORY',
      renditionCount: Number(e.rendition_count) || 0,
      hasRenditions: (Number(e.rendition_count) || 0) > 0,
      deleted: e.deleted === true,
      owner: e.owner || '',
      createdBy: e.created_by || '',
      modifiedBy: e.modified_by || '',
    }));
  }

  listDeleted(uid: string): Promise<DirectoryEntry[]> {
    return this.dir(uid, true);
  }

  /**
   * List a file's hidden renditions (alternate-format children). Renditions are
   * hidden from normal directory listings; pass the file's UID to reveal them.
   * Equivalent to listing the file's UID directly.
   */
  renditions(uid: string): Promise<DirectoryEntry[]> {
    return this.dir(uid, false);
  }

  // ------------------------------ file ops ----------------------------- //
  async touch(parentUid: string, name: string): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r: any;
    try { r = await this.call('Touch', { parent_uid: parentUid, name, auth: this.auth() }); }
    catch (e) { raiseRpc(e as grpc.ServiceError, 'touch', parentUid); }
    checkResponse(r, 'touch', parentUid);
    return r.uid;
  }

  async put(uid: string, payload: Buffer | string | null): Promise<number> {
    const data = payload == null ? Buffer.alloc(0) : (typeof payload === 'string' ? Buffer.from(payload) : payload);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r: any;
    try { r = await this.call('PutFile', { uid, data, auth: this.auth() }); }
    catch (e) { raiseRpc(e as grpc.ServiceError, 'put', uid); }
    checkResponse(r, 'put', uid);
    return Date.now() / 1000;
  }

  /**
   * Write a new version from an async iterable of chunks, without ever holding
   * the whole file in memory.
   *
   * `put()` sends the payload in one `PutFile` message, so it is bounded by the
   * message limit and by the caller's memory. This uses the client-streaming
   * `StreamFileUpload` RPC — the same one the C++ http_bridge has always used —
   * so the core pulls chunks straight into its storage writer.
   *
   * **Chunking is enforced, not offered.** Whatever sizes the caller yields,
   * this re-splits them so no single message exceeds `chunkSize`. Handing over
   * one large buffer is the natural thing to do and would otherwise produce
   * exactly the oversized message streaming exists to avoid.
   *
   * Wire protocol, matching the bridge's client: the FIRST message carries
   * `uid` + `auth` plus the first body chunk; later messages carry data only.
   * An empty source still sends one message with `uid` + `auth`, so the server
   * has a target and writes an empty version rather than erroring.
   */
  async putStream(
    uid: string,
    chunks: AsyncIterable<Buffer | Uint8Array | string> | Iterable<Buffer | Uint8Array | string>,
    chunkSize: number = MAX_WIRE_CHUNK,
  ): Promise<number> {
    const limit = Math.max(1, chunkSize);
    const auth = this.auth();

    return new Promise<number>((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream: any = this.client.StreamFileUpload(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (err: grpc.ServiceError | null, response: any) => {
          if (err) { try { raiseRpc(err, 'putStream', uid); } catch (e) { reject(e); } return; }
          try { checkResponse(response, 'putStream', uid); } catch (e) { reject(e); return; }
          resolve(Date.now() / 1000);
        },
      );

      (async () => {
        let first = true;
        try {
          for await (const raw of chunks as AsyncIterable<Buffer | Uint8Array | string>) {
            if (raw == null) continue;
            const buf = typeof raw === 'string' ? Buffer.from(raw) : Buffer.from(raw);
            if (buf.length === 0) continue;   // would end nothing early
            for (let off = 0; off < buf.length; off += limit) {
              const piece = buf.subarray(off, Math.min(off + limit, buf.length));
              const msg = first
                ? { uid, auth, data: piece }
                : { data: piece };
              first = false;
              if (!stream.write(msg)) {
                await new Promise<void>((r) => stream.once('drain', r));
              }
            }
          }
          if (first) stream.write({ uid, auth });
          stream.end();
        } catch (e) {
          stream.destroy(e as Error);
          reject(e);
        }
      })();
    });
  }

  /**
   * Yield a version's content as it arrives, without accumulating the whole
   * file; `version` empty means the current one. The counterpart to `putStream`.
   *
   * Prefer this over `get(uid, back)` for a specific version: that falls back
   * to the unary `GetVersion`, which is capped by the message limit.
   *
   * Caveat that is not this client's to fix: the core writes one gRPC message
   * per chunk its storage layer produces, and that is sometimes the entire
   * file — so the server may still emit one very large message regardless of
   * what this does. Bounding it needs the core to chunk its storage reads.
   */
  async *getStream(uid: string, version = ''): AsyncGenerator<Buffer, void, unknown> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream: any = this.client.StreamFileDownload(
      { uid, version_timestamp: version, auth: this.auth() });
    const queue: Buffer[] = [];
    let done = false;
    let failed: unknown = null;
    let wake: (() => void) | null = null;
    const bump = () => { const w = wake; wake = null; if (w) w(); };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stream.on('data', (resp: any) => {
      try { checkResponse(resp, 'getStream', uid, NotFoundError); }
      catch (e) { failed = e; stream.destroy(); bump(); return; }
      if (resp.data && resp.data.length) queue.push(Buffer.from(resp.data));
      bump();
    });
    stream.on('error', (err: grpc.ServiceError) => {
      try { raiseRpc(err, 'getStream', uid); } catch (e) { failed = e; }
      done = true; bump();
    });
    stream.on('end', () => { done = true; bump(); });

    for (;;) {
      while (queue.length) yield queue.shift() as Buffer;
      if (failed) throw failed;
      if (done) return;
      await new Promise<void>((r) => { wake = r; });
    }
  }

  async get(uid: string, back = 0): Promise<Buffer> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r: any;
    if (back === 0) {
      try { r = await this.call('GetFile', { uid, auth: this.auth() }); }
      catch (e) { raiseRpc(e as grpc.ServiceError, 'get', uid); }
      checkResponse(r, 'get', uid, NotFoundError);
      return Buffer.from(r.data);
    }
    const versions = await this.revisions(uid);
    if (versions.length <= back) {
      throw new NotFoundError(`version ${back} back does not exist`, { operation: 'get', uid });
    }
    try { r = await this.call('GetVersion', { uid, version_timestamp: versions[back].version, auth: this.auth() }); }
    catch (e) { raiseRpc(e as grpc.ServiceError, 'get', uid); }
    checkResponse(r, 'get', uid, NotFoundError);
    return Buffer.from(r.data);
  }

  /**
   * Return true if the entity exists, false if it does not. Non-existence is a
   * normal answer; an actual failure (unreachable, read-only, auth) throws.
   */
  async exists(uid: string): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r: any;
    try { r = await this.call('Exists', { uid, auth: this.auth() }); }
    catch (e) { raiseRpc(e as grpc.ServiceError, 'exists', uid); }
    checkResponse(r, 'exists', uid);
    return Boolean(r.exists);
  }

  /** Return a FileInfo for the entity; throws {@link NotFoundError} if absent. */
  async stat(uid: string): Promise<FileInfo> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r: any;
    try { r = await this.call('Stat', { uid, auth: this.auth() }); }
    catch (e) { raiseRpc(e as grpc.ServiceError, 'stat', uid); }
    checkResponse(r, 'stat', uid, NotFoundError);
    const i = r.info;
    return {
      uid: i.uid,
      name: i.name,
      parentUid: i.parent_uid || '',
      type: i.type as FileTypeName,
      size: Number(i.size) || 0,
      owner: i.owner || '',
      permissions: Number(i.permissions) || 0,
      createdAt: safeDate(i.created_at),
      modifiedAt: safeDate(i.modified_at),
      version: i.version || '',
      isDir: i.type === 'DIRECTORY',
      renditionCount: Number(i.rendition_count) || 0,
      hasRenditions: (Number(i.rendition_count) || 0) > 0,
    };
  }

  /** True if the entity is a directory (false if it does not exist). */
  async isDir(uid: string): Promise<boolean> {
    try { return (await this.stat(uid)).isDir; }
    catch (e) { if (e instanceof NotFoundError) return false; throw e; }
  }

  async getParent(uid: string): Promise<string> {
    try { return (await this.stat(uid)).parentUid; }
    catch (e) { if (e instanceof NotFoundError) return ''; throw e; }
  }

  async fileName(uid: string): Promise<string[]> {
    try { return [(await this.stat(uid)).name]; }
    catch (e) { if (e instanceof NotFoundError) return []; throw e; }
  }

  async getFileMtime(uid: string): Promise<Date | null> {
    try { return (await this.stat(uid)).modifiedAt; }
    catch (e) { if (e instanceof NotFoundError) return null; throw e; }
  }

  async getFolderCdate(uid: string): Promise<Date | null> {
    try { return (await this.stat(uid)).createdAt; }
    catch (e) { if (e instanceof NotFoundError) return null; throw e; }
  }

  // -------------------------- manipulation ----------------------------- //
  async rename(uid: string, newName: string): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r: any;
    try { r = await this.call('Rename', { uid, new_name: newName, auth: this.auth() }); }
    catch (e) { raiseRpc(e as grpc.ServiceError, 'rename', uid); }
    checkResponse(r, 'rename', uid);
    return true;
  }

  async move(sourceUid: string, destinationUid: string, newName?: string): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r: any;
    try { r = await this.call('Move', { source_uid: sourceUid, destination_parent_uid: destinationUid, auth: this.auth() }); }
    catch (e) { raiseRpc(e as grpc.ServiceError, 'move', sourceUid); }
    checkResponse(r, 'move', sourceUid);
    if (newName) await this.rename(sourceUid, newName);
    return true;
  }

  async copy(sourceUid: string, destinationUid: string): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r: any;
    try { r = await this.call('Copy', { source_uid: sourceUid, destination_parent_uid: destinationUid, auth: this.auth() }); }
    catch (e) { raiseRpc(e as grpc.ServiceError, 'copy', sourceUid); }
    checkResponse(r, 'copy', sourceUid);
    return true;
  }

  async remove(uid: string): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r: any;
    try {
      const info = await this.call('Stat', { uid, auth: this.auth() });
      if (info.success && info.info.type === 'DIRECTORY') {
        r = await this.call('RemoveDirectory', { uid, auth: this.auth() });
      } else {
        r = await this.call('RemoveFile', { uid, auth: this.auth() });
      }
    } catch (e) { raiseRpc(e as grpc.ServiceError, 'remove', uid); }
    checkResponse(r, 'remove', uid);
    return true;
  }

  async undeleteFile(uid: string): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r: any;
    try { r = await this.call('UndeleteFile', { uid, auth: this.auth() }); }
    catch (e) { raiseRpc(e as grpc.ServiceError, 'undeleteFile', uid); }
    checkResponse(r, 'undeleteFile', uid);
    return true;
  }

  // ------------------------------ versions ----------------------------- //
  async revisions(uid: string): Promise<Revision[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r: any;
    try { r = await this.call('ListVersions', { uid, auth: this.auth() }); }
    catch (e) { raiseRpc(e as grpc.ServiceError, 'revisions', uid); }
    checkResponse(r, 'revisions', uid, NotFoundError);
    // Prefer `entries`, which carries the uploader. `versions` is the older
    // timestamp-only field, still populated by the core; falling back to it keeps
    // this working against a core that predates the change — with an empty user
    // rather than a wrong one.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entries: any[] = r.entries || [];
    if (entries.length) {
      return entries.map((e): Revision => ({
        version: e.version_timestamp,
        name: uid,
        user: e.revised_by || '',
      }));
    }
    return (r.versions || []).map((ts: string): Revision => ({ version: ts, name: uid, user: '' }));
  }

  async restoreToVersion(uid: string, versionTimestamp: string): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r: any;
    try { r = await this.call('RestoreToVersion', { uid, version_timestamp: versionTimestamp, auth: this.auth() }); }
    catch (e) { raiseRpc(e as grpc.ServiceError, 'restoreToVersion', uid); }
    checkResponse(r, 'restoreToVersion', uid);
    return r.restored_version;
  }

  async purgeOldVersions(uid: string, keepCount: number): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r: any;
    try { r = await this.call('PurgeOldVersions', { uid, keep_count: keepCount, auth: this.auth() }); }
    catch (e) { raiseRpc(e as grpc.ServiceError, 'purgeOldVersions', uid); }
    checkResponse(r, 'purgeOldVersions', uid);
    return true;
  }

  // ------------------------------ metadata ----------------------------- //
  async setMetadataValue(uid: string, key: string, value: string): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r: any;
    try { r = await this.call('SetMetadata', { uid, key, value, auth: this.auth() }); }
    catch (e) { raiseRpc(e as grpc.ServiceError, 'setMetadataValue', uid); }
    checkResponse(r, 'setMetadataValue', uid);
    return true;
  }

  async getMetadataValue(uid: string, key: string): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r: any;
    try { r = await this.call('GetMetadata', { uid, key, auth: this.auth() }); }
    catch (e) { raiseRpc(e as grpc.ServiceError, 'getMetadataValue', uid); }
    checkResponse(r, 'getMetadataValue', uid, NotFoundError);
    return r.value;
  }

  async getMetadataValues(uid: string): Promise<{ [k: string]: string }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r: any;
    try { r = await this.call('GetAllMetadata', { uid, auth: this.auth() }); }
    catch (e) { raiseRpc(e as grpc.ServiceError, 'getMetadataValues', uid); }
    checkResponse(r, 'getMetadataValues', uid, NotFoundError);
    return r.metadata || {};
  }

  async deleteMetadataValue(uid: string, key: string): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r: any;
    try { r = await this.call('DeleteMetadata', { uid, key, auth: this.auth() }); }
    catch (e) { raiseRpc(e as grpc.ServiceError, 'deleteMetadataValue', uid); }
    checkResponse(r, 'deleteMetadataValue', uid);
    return true;
  }

  async getMetadataForVersion(uid: string, version: string, key: string): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r: any;
    try { r = await this.call('GetMetadataForVersion', { uid, version_timestamp: String(version), key, auth: this.auth() }); }
    catch (e) { raiseRpc(e as grpc.ServiceError, 'getMetadataForVersion', uid); }
    checkResponse(r, 'getMetadataForVersion', uid, NotFoundError);
    return r.value;
  }

  async getAllMetadataForVersion(uid: string, version: string): Promise<{ [k: string]: string }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r: any;
    try { r = await this.call('GetAllMetadataForVersion', { uid, version_timestamp: String(version), auth: this.auth() }); }
    catch (e) { raiseRpc(e as grpc.ServiceError, 'getAllMetadataForVersion', uid); }
    checkResponse(r, 'getAllMetadataForVersion', uid, NotFoundError);
    return r.metadata || {};
  }

  // --------------------------- permissions ----------------------------- //
  // `claims` lets CLAIM-type (ABAC) rules match — pass the requester's auth
  // claims (key->value). Omit for plain user/role checks.
  async checkPermission(resourceUid: string, permission: PermissionName | string, user?: string, roles?: string[], claims?: { [k: string]: string }): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r: any;
    try {
      r = await this.call('CheckPermission', {
        resource_uid: resourceUid,
        required_permission: coercePermission(permission),
        auth: this.auth(user, roles, undefined, claims),
      });
    } catch (e) { raiseRpc(e as grpc.ServiceError, 'checkPermission', resourceUid); }
    checkResponse(r, 'checkPermission', resourceUid);
    return Boolean(r.has_permission);
  }

  /**
   * Resolve a principal's full effective permission set on a resource in one
   * call, without accessing the entity. Returns permission names (e.g.
   * ['READ','WRITE']). Intended for systems that must respect filesystem
   * permissions (e.g. a search indexer). `claims` are forwarded on the auth
   * context and feed CLAIM-type (ABAC) rule matching.
   */
  async getEffectivePermissions(
    resourceUid: string,
    user?: string,
    roles?: string[],
    claims?: { [k: string]: string },
  ): Promise<PermissionName[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r: any;
    try {
      r = await this.call('GetEffectivePermissions', {
        resource_uid: resourceUid,
        auth: this.auth(user, roles, undefined, claims),
      });
    } catch (e) { raiseRpc(e as grpc.ServiceError, 'getEffectivePermissions', resourceUid); }
    checkResponse(r, 'getEffectivePermissions', resourceUid);
    return (r.permissions || []) as PermissionName[];
  }

  async grantPermission(resourceUid: string, principal: string, permission: PermissionName | string, effect: AclEffectName | string = 'ALLOW'): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r: any;
    try {
      r = await this.call('GrantPermission', {
        resource_uid: resourceUid, principal,
        permission: coercePermission(permission), effect: coerceEffect(effect),
        auth: this.auth(),
      });
    } catch (e) { raiseRpc(e as grpc.ServiceError, 'grantPermission', resourceUid); }
    checkResponse(r, 'grantPermission', resourceUid);
    return true;
  }

  async revokePermission(resourceUid: string, principal: string, permission: PermissionName | string, effect: AclEffectName | string = 'ALLOW'): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r: any;
    try {
      r = await this.call('RevokePermission', {
        resource_uid: resourceUid, principal,
        permission: coercePermission(permission), effect: coerceEffect(effect),
        auth: this.auth(),
      });
    } catch (e) { raiseRpc(e as grpc.ServiceError, 'revokePermission', resourceUid); }
    checkResponse(r, 'revokePermission', resourceUid);
    return true;
  }

  // ------------------------------- roles ------------------------------- //
  async createRole(role: string): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r: any;
    try { r = await this.call('CreateRole', { role, auth: this.auth() }); }
    catch (e) { raiseRpc(e as grpc.ServiceError, 'createRole'); }
    checkResponse(r, 'createRole');
    return true;
  }

  async deleteRole(role: string): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r: any;
    try { r = await this.call('DeleteRole', { role, auth: this.auth() }); }
    catch (e) { raiseRpc(e as grpc.ServiceError, 'deleteRole'); }
    checkResponse(r, 'deleteRole');
    return true;
  }

  async assignUserToRole(targetUser: string, role: string): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r: any;
    try { r = await this.call('AssignUserToRole', { user: targetUser, role, auth: this.auth() }); }
    catch (e) { raiseRpc(e as grpc.ServiceError, 'assignUserToRole'); }
    checkResponse(r, 'assignUserToRole');
    return true;
  }

  async removeUserFromRole(targetUser: string, role: string): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r: any;
    try { r = await this.call('RemoveUserFromRole', { user: targetUser, role, auth: this.auth() }); }
    catch (e) { raiseRpc(e as grpc.ServiceError, 'removeUserFromRole'); }
    checkResponse(r, 'removeUserFromRole');
    return true;
  }

  async getRolesForUser(targetUser: string): Promise<string[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r: any;
    try { r = await this.call('GetRolesForUser', { user: targetUser, auth: this.auth() }); }
    catch (e) { raiseRpc(e as grpc.ServiceError, 'getRolesForUser'); }
    checkResponse(r, 'getRolesForUser');
    return r.roles || [];
  }

  async getUsersForRole(role: string): Promise<string[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r: any;
    try { r = await this.call('GetUsersForRole', { role, auth: this.auth() }); }
    catch (e) { raiseRpc(e as grpc.ServiceError, 'getUsersForRole'); }
    checkResponse(r, 'getUsersForRole');
    return r.users || [];
  }

  async getAllRoles(): Promise<string[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r: any;
    try { r = await this.call('GetAllRoles', { auth: this.auth() }); }
    catch (e) { raiseRpc(e as grpc.ServiceError, 'getAllRoles'); }
    checkResponse(r, 'getAllRoles');
    return r.roles || [];
  }

  // --------------------------- administrative -------------------------- //
  async getStorageUsage(): Promise<StorageUsage> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r: any;
    try { r = await this.call('GetStorageUsage', { auth: this.auth(), tenant: this.tenant }); }
    catch (e) { raiseRpc(e as grpc.ServiceError, 'getStorageUsage'); }
    checkResponse(r, 'getStorageUsage');
    return {
      totalSpace: Number(r.total_space) || 0,
      usedSpace: Number(r.used_space) || 0,
      availableSpace: Number(r.available_space) || 0,
      usagePercentage: Number(r.usage_percentage) || 0,
    };
  }

  async triggerSync(): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r: any;
    try { r = await this.call('TriggerSync', { tenant: this.tenant, auth: this.auth() }); }
    catch (e) { raiseRpc(e as grpc.ServiceError, 'triggerSync'); }
    checkResponse(r, 'triggerSync');
    return true;
  }
}

export default FileEngineClient;
