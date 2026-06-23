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
 */
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';
import * as fs from 'fs';

export const ROOT_UID = '';
export const ZERO_UID = '00000000-0000-0000-0000-000000000000';

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
}

export interface Revision {
  version: string;
  name: string;
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

/**
 * High-level FileEngine client, equivalent to the Python `ManagedFiles`.
 * Stores a default user/roles/tenant/claims used for every call (overridable
 * per call). Methods resolve to friendly values (uid string, Buffer, typed
 * models) or `false`/`null`/`[]` on error.
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
  async mkdir(parentUid: string, name: string): Promise<string | false> {
    try {
      const r = await this.call('MakeDirectory', { parent_uid: parentUid, name, auth: this.auth() });
      return r.success ? r.uid : false;
    } catch { return false; }
  }

  async dir(uid: string, showDeleted = false): Promise<DirectoryEntry[] | false> {
    try {
      const method = showDeleted ? 'ListDirectoryWithDeleted' : 'ListDirectory';
      const r = await this.call(method, { uid, auth: this.auth() });
      if (!r.success) return false;
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
      }));
    } catch { return false; }
  }

  listDeleted(uid: string): Promise<DirectoryEntry[] | false> {
    return this.dir(uid, true);
  }

  /**
   * List a file's hidden renditions (alternate-format children). Renditions are
   * hidden from normal directory listings; pass the file's UID to reveal them.
   * Equivalent to listing the file's UID directly.
   */
  renditions(uid: string): Promise<DirectoryEntry[] | false> {
    return this.dir(uid, false);
  }

  // ------------------------------ file ops ----------------------------- //
  async touch(parentUid: string, name: string): Promise<string | false> {
    try {
      const r = await this.call('Touch', { parent_uid: parentUid, name, auth: this.auth() });
      return r.success ? r.uid : false;
    } catch { return false; }
  }

  async put(uid: string, payload: Buffer | string | null): Promise<number | false> {
    const data = payload == null ? Buffer.alloc(0) : (typeof payload === 'string' ? Buffer.from(payload) : payload);
    try {
      const r = await this.call('PutFile', { uid, data, auth: this.auth() });
      return r.success ? Date.now() / 1000 : false;
    } catch { return false; }
  }

  async get(uid: string, back = 0): Promise<Buffer | false> {
    try {
      if (back === 0) {
        const r = await this.call('GetFile', { uid, auth: this.auth() });
        return r.success ? Buffer.from(r.data) : false;
      }
      const versions = await this.revisions(uid);
      if (versions.length <= back) return false;
      const r = await this.call('GetVersion', { uid, version_timestamp: versions[back].version, auth: this.auth() });
      return r.success ? Buffer.from(r.data) : false;
    } catch { return false; }
  }

  async exists(uid: string): Promise<boolean> {
    try {
      const r = await this.call('Exists', { uid, auth: this.auth() });
      return Boolean(r.success && r.exists);
    } catch { return false; }
  }

  async stat(uid: string): Promise<FileInfo | null> {
    try {
      const r = await this.call('Stat', { uid, auth: this.auth() });
      if (!r.success) return null;
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
    } catch { return null; }
  }

  async isDir(uid: string): Promise<boolean> {
    const info = await this.stat(uid);
    return Boolean(info && info.isDir);
  }

  async getParent(uid: string): Promise<string> {
    const info = await this.stat(uid);
    return info ? info.parentUid : '';
  }

  async fileName(uid: string): Promise<string[]> {
    const info = await this.stat(uid);
    return info ? [info.name] : [];
  }

  async getFileMtime(uid: string): Promise<Date | null> {
    const info = await this.stat(uid);
    return info ? info.modifiedAt : null;
  }

  async getFolderCdate(uid: string): Promise<Date | null> {
    const info = await this.stat(uid);
    return info ? info.createdAt : null;
  }

  // -------------------------- manipulation ----------------------------- //
  async rename(uid: string, newName: string): Promise<boolean> {
    try { return (await this.call('Rename', { uid, new_name: newName, auth: this.auth() })).success; }
    catch { return false; }
  }

  async move(sourceUid: string, destinationUid: string, newName?: string): Promise<boolean> {
    try {
      const r = await this.call('Move', { source_uid: sourceUid, destination_parent_uid: destinationUid, auth: this.auth() });
      if (r.success && newName) return this.rename(sourceUid, newName);
      return r.success;
    } catch { return false; }
  }

  async copy(sourceUid: string, destinationUid: string): Promise<boolean> {
    try { return (await this.call('Copy', { source_uid: sourceUid, destination_parent_uid: destinationUid, auth: this.auth() })).success; }
    catch { return false; }
  }

  async remove(uid: string): Promise<boolean> {
    try {
      const info = await this.call('Stat', { uid, auth: this.auth() });
      if (info.success && info.info.type === 'DIRECTORY') {
        return (await this.call('RemoveDirectory', { uid, auth: this.auth() })).success;
      }
      return (await this.call('RemoveFile', { uid, auth: this.auth() })).success;
    } catch { return false; }
  }

  async undeleteFile(uid: string): Promise<boolean> {
    try { return (await this.call('UndeleteFile', { uid, auth: this.auth() })).success; }
    catch { return false; }
  }

  // ------------------------------ versions ----------------------------- //
  async revisions(uid: string): Promise<Revision[]> {
    try {
      const r = await this.call('ListVersions', { uid, auth: this.auth() });
      if (!r.success) return [];
      return (r.versions || []).map((ts: string): Revision => ({ version: ts, name: uid, user: this.user }));
    } catch { return []; }
  }

  async restoreToVersion(uid: string, versionTimestamp: string): Promise<string | false> {
    try {
      const r = await this.call('RestoreToVersion', { uid, version_timestamp: versionTimestamp, auth: this.auth() });
      return r.success ? r.restored_version : false;
    } catch { return false; }
  }

  async purgeOldVersions(uid: string, keepCount: number): Promise<boolean> {
    try { return (await this.call('PurgeOldVersions', { uid, keep_count: keepCount, auth: this.auth() })).success; }
    catch { return false; }
  }

  // ------------------------------ metadata ----------------------------- //
  async setMetadataValue(uid: string, key: string, value: string): Promise<boolean> {
    try { return (await this.call('SetMetadata', { uid, key, value, auth: this.auth() })).success; }
    catch { return false; }
  }

  async getMetadataValue(uid: string, key: string): Promise<string | null> {
    try { const r = await this.call('GetMetadata', { uid, key, auth: this.auth() }); return r.success ? r.value : null; }
    catch { return null; }
  }

  async getMetadataValues(uid: string): Promise<{ [k: string]: string }> {
    try { const r = await this.call('GetAllMetadata', { uid, auth: this.auth() }); return r.success ? (r.metadata || {}) : {}; }
    catch { return {}; }
  }

  async deleteMetadataValue(uid: string, key: string): Promise<boolean> {
    try { return (await this.call('DeleteMetadata', { uid, key, auth: this.auth() })).success; }
    catch { return false; }
  }

  async getMetadataForVersion(uid: string, version: string, key: string): Promise<string | null> {
    try { const r = await this.call('GetMetadataForVersion', { uid, version_timestamp: String(version), key, auth: this.auth() }); return r.success ? r.value : null; }
    catch { return null; }
  }

  async getAllMetadataForVersion(uid: string, version: string): Promise<{ [k: string]: string }> {
    try { const r = await this.call('GetAllMetadataForVersion', { uid, version_timestamp: String(version), auth: this.auth() }); return r.success ? (r.metadata || {}) : {}; }
    catch { return {}; }
  }

  // --------------------------- permissions ----------------------------- //
  // `claims` lets CLAIM-type (ABAC) rules match — pass the requester's auth
  // claims (key->value). Omit for plain user/role checks.
  async checkPermission(resourceUid: string, permission: PermissionName | string, user?: string, roles?: string[], claims?: { [k: string]: string }): Promise<boolean> {
    try {
      const r = await this.call('CheckPermission', {
        resource_uid: resourceUid,
        required_permission: coercePermission(permission),
        auth: this.auth(user, roles, undefined, claims),
      });
      return Boolean(r.success && r.has_permission);
    } catch { return false; }
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
    try {
      const r = await this.call('GetEffectivePermissions', {
        resource_uid: resourceUid,
        auth: this.auth(user, roles, undefined, claims),
      });
      if (!r.success) return [];
      return (r.permissions || []) as PermissionName[];
    } catch { return []; }
  }

  async grantPermission(resourceUid: string, principal: string, permission: PermissionName | string, effect: AclEffectName | string = 'ALLOW'): Promise<boolean> {
    try {
      return (await this.call('GrantPermission', {
        resource_uid: resourceUid, principal,
        permission: coercePermission(permission), effect: coerceEffect(effect),
        auth: this.auth(),
      })).success;
    } catch { return false; }
  }

  async revokePermission(resourceUid: string, principal: string, permission: PermissionName | string, effect: AclEffectName | string = 'ALLOW'): Promise<boolean> {
    try {
      return (await this.call('RevokePermission', {
        resource_uid: resourceUid, principal,
        permission: coercePermission(permission), effect: coerceEffect(effect),
        auth: this.auth(),
      })).success;
    } catch { return false; }
  }

  // ------------------------------- roles ------------------------------- //
  async createRole(role: string): Promise<boolean> {
    try { return (await this.call('CreateRole', { role, auth: this.auth() })).success; } catch { return false; }
  }

  async deleteRole(role: string): Promise<boolean> {
    try { return (await this.call('DeleteRole', { role, auth: this.auth() })).success; } catch { return false; }
  }

  async assignUserToRole(targetUser: string, role: string): Promise<boolean> {
    try { return (await this.call('AssignUserToRole', { user: targetUser, role, auth: this.auth() })).success; } catch { return false; }
  }

  async removeUserFromRole(targetUser: string, role: string): Promise<boolean> {
    try { return (await this.call('RemoveUserFromRole', { user: targetUser, role, auth: this.auth() })).success; } catch { return false; }
  }

  async getRolesForUser(targetUser: string): Promise<string[]> {
    try { const r = await this.call('GetRolesForUser', { user: targetUser, auth: this.auth() }); return r.success ? (r.roles || []) : []; } catch { return []; }
  }

  async getUsersForRole(role: string): Promise<string[]> {
    try { const r = await this.call('GetUsersForRole', { role, auth: this.auth() }); return r.success ? (r.users || []) : []; } catch { return []; }
  }

  async getAllRoles(): Promise<string[]> {
    try { const r = await this.call('GetAllRoles', { auth: this.auth() }); return r.success ? (r.roles || []) : []; } catch { return []; }
  }

  // --------------------------- administrative -------------------------- //
  async getStorageUsage(): Promise<StorageUsage | null> {
    try {
      const r = await this.call('GetStorageUsage', { auth: this.auth(), tenant: this.tenant });
      if (!r.success) return null;
      return {
        totalSpace: Number(r.total_space) || 0,
        usedSpace: Number(r.used_space) || 0,
        availableSpace: Number(r.available_space) || 0,
        usagePercentage: Number(r.usage_percentage) || 0,
      };
    } catch { return null; }
  }

  async triggerSync(): Promise<boolean> {
    try { return (await this.call('TriggerSync', { tenant: this.tenant, auth: this.auth() })).success; }
    catch { return false; }
  }
}

export default FileEngineClient;
