import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

// Define TypeScript interfaces based on the proto file
interface AuthenticationContext {
  user: string;
  roles: string[];
  tenant: string;
  claims: { [key: string]: string };
}

interface DirectoryEntry {
  uid: string;
  name: string;
  type: FileType;
  size: number;
  created_at: number;
  modified_at: number;
  version_count: number;
}

enum FileType {
  REGULAR_FILE = 0,
  DIRECTORY = 1,
  SYMLINK = 2
}

enum Permission {
  READ = 0,
  WRITE = 1,
  DELETE = 2,
  LIST_DELETED = 3,
  UNDELETE = 4,
  VIEW_VERSIONS = 5,
  RETRIEVE_BACK_VERSION = 6,
  RESTORE_TO_VERSION = 7,
  EXECUTE = 8
}

interface FileInfo {
  uid: string;
  name: string;
  parent_uid: string;
  type: FileType;
  size: number;
  owner: string;
  permissions: number;
  created_at: number;
  modified_at: number;
  version: string;
}

// Define request/response interfaces
interface MakeDirectoryRequest {
  parent_uid: string;
  name: string;
  auth: AuthenticationContext;
  permissions: number;
}

interface MakeDirectoryResponse {
  success: boolean;
  error?: string;
  uid?: string;
}

interface RemoveDirectoryRequest {
  uid: string;
  auth: AuthenticationContext;
}

interface RemoveDirectoryResponse {
  success: boolean;
  error?: string;
}

interface ListDirectoryRequest {
  uid: string;
  auth: AuthenticationContext;
}

interface ListDirectoryResponse {
  success: boolean;
  error?: string;
  entries: DirectoryEntry[];
}

interface ListDirectoryWithDeletedRequest {
  uid: string;
  auth: AuthenticationContext;
}

interface ListDirectoryWithDeletedResponse {
  success: boolean;
  error?: string;
  entries: DirectoryEntry[];
}

interface TouchRequest {
  parent_uid: string;
  name: string;
  auth: AuthenticationContext;
}

interface TouchResponse {
  success: boolean;
  error?: string;
  uid?: string;
}

interface RemoveFileRequest {
  uid: string;
  auth: AuthenticationContext;
}

interface RemoveFileResponse {
  success: boolean;
  error?: string;
}

interface UndeleteFileRequest {
  uid: string;
  auth: AuthenticationContext;
}

interface UndeleteFileResponse {
  success: boolean;
  error?: string;
}

interface PutFileRequest {
  uid: string;
  auth: AuthenticationContext;
  data: Buffer;
  chunk_index?: number;
  total_chunks?: number;
}

interface PutFileResponse {
  success: boolean;
  error?: string;
}

interface GetFileRequest {
  uid: string;
  version_timestamp?: string;
  auth: AuthenticationContext;
}

interface GetFileResponse {
  success: boolean;
  error?: string;
  data?: Buffer;
}

interface StatRequest {
  uid: string;
  auth: AuthenticationContext;
}

interface StatResponse {
  success: boolean;
  error?: string;
  info?: FileInfo;
}

interface ExistsRequest {
  uid: string;
  auth: AuthenticationContext;
}

interface ExistsResponse {
  success: boolean;
  error?: string;
  exists: boolean;
}

interface RenameRequest {
  uid: string;
  new_name: string;
  auth: AuthenticationContext;
}

interface RenameResponse {
  success: boolean;
  error?: string;
}

interface MoveRequest {
  source_uid: string;
  destination_parent_uid: string;
  auth: AuthenticationContext;
}

interface MoveResponse {
  success: boolean;
  error?: string;
}

interface CopyRequest {
  source_uid: string;
  destination_parent_uid: string;
  auth: AuthenticationContext;
}

interface CopyResponse {
  success: boolean;
  error?: string;
}

interface ListVersionsRequest {
  uid: string;
  auth: AuthenticationContext;
}

interface ListVersionsResponse {
  success: boolean;
  error?: string;
  versions: string[];
}

interface GetVersionRequest {
  uid: string;
  version_timestamp: string;
  auth: AuthenticationContext;
}

interface GetVersionResponse {
  success: boolean;
  error?: string;
  data?: Buffer;
}

interface RestoreToVersionRequest {
  uid: string;
  version_timestamp: string;
  auth: AuthenticationContext;
}

interface RestoreToVersionResponse {
  success: boolean;
  error?: string;
  restored_version?: string;
}

interface SetMetadataRequest {
  uid: string;
  key: string;
  value: string;
  auth: AuthenticationContext;
}

interface SetMetadataResponse {
  success: boolean;
  error?: string;
}

interface GetMetadataRequest {
  uid: string;
  key: string;
  auth: AuthenticationContext;
}

interface GetMetadataResponse {
  success: boolean;
  error?: string;
  value?: string;
}

interface GetAllMetadataRequest {
  uid: string;
  auth: AuthenticationContext;
}

interface GetAllMetadataResponse {
  success: boolean;
  error?: string;
  metadata: { [key: string]: string };
}

interface DeleteMetadataRequest {
  uid: string;
  key: string;
  auth: AuthenticationContext;
}

interface DeleteMetadataResponse {
  success: boolean;
  error?: string;
}

interface GetMetadataForVersionRequest {
  uid: string;
  version_timestamp: string;
  key: string;
  auth: AuthenticationContext;
}

interface GetMetadataForVersionResponse {
  success: boolean;
  error?: string;
  value?: string;
}

interface GetAllMetadataForVersionRequest {
  uid: string;
  version_timestamp: string;
  auth: AuthenticationContext;
}

interface GetAllMetadataForVersionResponse {
  success: boolean;
  error?: string;
  metadata: { [key: string]: string };
}

interface GrantPermissionRequest {
  resource_uid: string;
  principal: string;
  permission: Permission;
  auth: AuthenticationContext;
}

interface GrantPermissionResponse {
  success: boolean;
  error?: string;
}

interface RevokePermissionRequest {
  resource_uid: string;
  principal: string;
  permission: Permission;
  auth: AuthenticationContext;
}

interface RevokePermissionResponse {
  success: boolean;
  error?: string;
}

interface CheckPermissionRequest {
  resource_uid: string;
  required_permission: Permission;
  auth: AuthenticationContext;
}

interface CheckPermissionResponse {
  success: boolean;
  error?: string;
  has_permission: boolean;
}

interface StorageUsageRequest {
  auth: AuthenticationContext;
  tenant?: string;
}

interface StorageUsageResponse {
  success: boolean;
  error?: string;
  total_space: number;
  used_space: number;
  available_space: number;
  usage_percentage: number;
}

interface PurgeOldVersionsRequest {
  uid: string;
  keep_count: number;
  auth: AuthenticationContext;
}

interface PurgeOldVersionsResponse {
  success: boolean;
  error?: string;
}

interface TriggerSyncRequest {
  tenant?: string;
  auth: AuthenticationContext;
}

interface TriggerSyncResponse {
  success: boolean;
  error?: string;
}

// Load the proto file
const PROTO_PATH = __dirname + '/../file_engine_core/proto/fileservice.proto';

const packageDefinition = protoLoader.loadSync(
  PROTO_PATH,
  {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
  }
);

const fileengine_rpc = grpc.loadPackageDefinition(packageDefinition).fileengine_rpc;

class FileEngineClient {
  private client: any;

  constructor(serverAddress: string = 'localhost:50051') {
    this.client = new fileengine_rpc.FileService(
      serverAddress,
      grpc.credentials.createInsecure()
    );
  }

  // Helper function to create auth context
  private createAuthContext(user: string, roles: string[] = [], tenant: string = 'default', claims: { [key: string]: string } = {}): AuthenticationContext {
    return {
      user,
      roles,
      tenant,
      claims
    };
  }

  // Directory operations
  makeDirectory(parentUid: string, name: string, user: string, tenant: string = 'default'): Promise<MakeDirectoryResponse> {
    return new Promise((resolve, reject) => {
      const request: MakeDirectoryRequest = {
        parent_uid: parentUid,
        name,
        auth: this.createAuthContext(user, [], tenant),
        permissions: 0o755
      };

      this.client.MakeDirectory(request, (error: grpc.ServiceError, response: MakeDirectoryResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  removeDirectory(uid: string, user: string, tenant: string = 'default'): Promise<RemoveDirectoryResponse> {
    return new Promise((resolve, reject) => {
      const request: RemoveDirectoryRequest = {
        uid,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.RemoveDirectory(request, (error: grpc.ServiceError, response: RemoveDirectoryResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  listDirectory(uid: string, user: string, tenant: string = 'default'): Promise<ListDirectoryResponse> {
    return new Promise((resolve, reject) => {
      const request: ListDirectoryRequest = {
        uid,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.ListDirectory(request, (error: grpc.ServiceError, response: ListDirectoryResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  listDirectoryWithDeleted(uid: string, user: string, tenant: string = 'default'): Promise<ListDirectoryWithDeletedResponse> {
    return new Promise((resolve, reject) => {
      const request: ListDirectoryWithDeletedRequest = {
        uid,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.ListDirectoryWithDeleted(request, (error: grpc.ServiceError, response: ListDirectoryWithDeletedResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  // File operations
  touch(parentUid: string, name: string, user: string, tenant: string = 'default'): Promise<TouchResponse> {
    return new Promise((resolve, reject) => {
      const request: TouchRequest = {
        parent_uid: parentUid,
        name,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.Touch(request, (error: grpc.ServiceError, response: TouchResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  removeFile(uid: string, user: string, tenant: string = 'default'): Promise<RemoveFileResponse> {
    return new Promise((resolve, reject) => {
      const request: RemoveFileRequest = {
        uid,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.RemoveFile(request, (error: grpc.ServiceError, response: RemoveFileResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  undeleteFile(uid: string, user: string, tenant: string = 'default'): Promise<UndeleteFileResponse> {
    return new Promise((resolve, reject) => {
      const request: UndeleteFileRequest = {
        uid,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.UndeleteFile(request, (error: grpc.ServiceError, response: UndeleteFileResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  putFile(uid: string, data: Buffer | string, user: string, tenant: string = 'default'): Promise<PutFileResponse> {
    return new Promise((resolve, reject) => {
      const request: PutFileRequest = {
        uid,
        auth: this.createAuthContext(user, [], tenant),
        data: Buffer.isBuffer(data) ? data : Buffer.from(data)
      };

      this.client.PutFile(request, (error: grpc.ServiceError, response: PutFileResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  getFile(uid: string, user: string, versionTimestamp: string | null = null, tenant: string = 'default'): Promise<GetFileResponse> {
    return new Promise((resolve, reject) => {
      const request: GetFileRequest = {
        uid,
        version_timestamp: versionTimestamp || undefined,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.GetFile(request, (error: grpc.ServiceError, response: GetFileResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  // File information
  stat(uid: string, user: string, tenant: string = 'default'): Promise<StatResponse> {
    return new Promise((resolve, reject) => {
      const request: StatRequest = {
        uid,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.Stat(request, (error: grpc.ServiceError, response: StatResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  exists(uid: string, user: string, tenant: string = 'default'): Promise<ExistsResponse> {
    return new Promise((resolve, reject) => {
      const request: ExistsRequest = {
        uid,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.Exists(request, (error: grpc.ServiceError, response: ExistsResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  // File manipulation operations
  rename(uid: string, newName: string, user: string, tenant: string = 'default'): Promise<RenameResponse> {
    return new Promise((resolve, reject) => {
      const request: RenameRequest = {
        uid,
        new_name: newName,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.Rename(request, (error: grpc.ServiceError, response: RenameResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  move(sourceUid: string, destinationParentUid: string, user: string, tenant: string = 'default'): Promise<MoveResponse> {
    return new Promise((resolve, reject) => {
      const request: MoveRequest = {
        source_uid: sourceUid,
        destination_parent_uid: destinationParentUid,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.Move(request, (error: grpc.ServiceError, response: MoveResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  copy(sourceUid: string, destinationParentUid: string, user: string, tenant: string = 'default'): Promise<CopyResponse> {
    return new Promise((resolve, reject) => {
      const request: CopyRequest = {
        source_uid: sourceUid,
        destination_parent_uid: destinationParentUid,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.Copy(request, (error: grpc.ServiceError, response: CopyResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  // Version operations
  listVersions(uid: string, user: string, tenant: string = 'default'): Promise<ListVersionsResponse> {
    return new Promise((resolve, reject) => {
      const request: ListVersionsRequest = {
        uid,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.ListVersions(request, (error: grpc.ServiceError, response: ListVersionsResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  getVersion(uid: string, versionTimestamp: string, user: string, tenant: string = 'default'): Promise<GetVersionResponse> {
    return new Promise((resolve, reject) => {
      const request: GetVersionRequest = {
        uid,
        version_timestamp: versionTimestamp,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.GetVersion(request, (error: grpc.ServiceError, response: GetVersionResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  restoreToVersion(uid: string, versionTimestamp: string, user: string, tenant: string = 'default'): Promise<RestoreToVersionResponse> {
    return new Promise((resolve, reject) => {
      const request: RestoreToVersionRequest = {
        uid,
        version_timestamp: versionTimestamp,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.RestoreToVersion(request, (error: grpc.ServiceError, response: RestoreToVersionResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  // Metadata operations
  setMetadata(uid: string, key: string, value: string, user: string, tenant: string = 'default'): Promise<SetMetadataResponse> {
    return new Promise((resolve, reject) => {
      const request: SetMetadataRequest = {
        uid,
        key,
        value,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.SetMetadata(request, (error: grpc.ServiceError, response: SetMetadataResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  getMetadata(uid: string, key: string, user: string, tenant: string = 'default'): Promise<GetMetadataResponse> {
    return new Promise((resolve, reject) => {
      const request: GetMetadataRequest = {
        uid,
        key,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.GetMetadata(request, (error: grpc.ServiceError, response: GetMetadataResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  getAllMetadata(uid: string, user: string, tenant: string = 'default'): Promise<GetAllMetadataResponse> {
    return new Promise((resolve, reject) => {
      const request: GetAllMetadataRequest = {
        uid,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.GetAllMetadata(request, (error: grpc.ServiceError, response: GetAllMetadataResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  deleteMetadata(uid: string, key: string, user: string, tenant: string = 'default'): Promise<DeleteMetadataResponse> {
    return new Promise((resolve, reject) => {
      const request: DeleteMetadataRequest = {
        uid,
        key,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.DeleteMetadata(request, (error: grpc.ServiceError, response: DeleteMetadataResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  getMetadataForVersion(uid: string, versionTimestamp: string, key: string, user: string, tenant: string = 'default'): Promise<GetMetadataForVersionResponse> {
    return new Promise((resolve, reject) => {
      const request: GetMetadataForVersionRequest = {
        uid,
        version_timestamp: versionTimestamp,
        key,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.GetMetadataForVersion(request, (error: grpc.ServiceError, response: GetMetadataForVersionResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  getAllMetadataForVersion(uid: string, versionTimestamp: string, user: string, tenant: string = 'default'): Promise<GetAllMetadataForVersionResponse> {
    return new Promise((resolve, reject) => {
      const request: GetAllMetadataForVersionRequest = {
        uid,
        version_timestamp: versionTimestamp,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.GetAllMetadataForVersion(request, (error: grpc.ServiceError, response: GetAllMetadataForVersionResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  // ACL operations
  grantPermission(resourceUid: string, principal: string, permission: Permission, user: string, tenant: string = 'default'): Promise<GrantPermissionResponse> {
    return new Promise((resolve, reject) => {
      const request: GrantPermissionRequest = {
        resource_uid: resourceUid,
        principal,
        permission,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.GrantPermission(request, (error: grpc.ServiceError, response: GrantPermissionResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  revokePermission(resourceUid: string, principal: string, permission: Permission, user: string, tenant: string = 'default'): Promise<RevokePermissionResponse> {
    return new Promise((resolve, reject) => {
      const request: RevokePermissionRequest = {
        resource_uid: resourceUid,
        principal,
        permission,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.RevokePermission(request, (error: grpc.ServiceError, response: RevokePermissionResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  checkPermission(resourceUid: string, requiredPermission: Permission, user: string, tenant: string = 'default'): Promise<CheckPermissionResponse> {
    return new Promise((resolve, reject) => {
      const request: CheckPermissionRequest = {
        resource_uid: resourceUid,
        required_permission: requiredPermission,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.CheckPermission(request, (error: grpc.ServiceError, response: CheckPermissionResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  // Administrative operations
  getStorageUsage(user: string, tenant: string = 'default'): Promise<StorageUsageResponse> {
    return new Promise((resolve, reject) => {
      const request: StorageUsageRequest = {
        auth: this.createAuthContext(user, [], tenant),
        tenant
      };

      this.client.GetStorageUsage(request, (error: grpc.ServiceError, response: StorageUsageResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  purgeOldVersions(uid: string, keepCount: number, user: string, tenant: string = 'default'): Promise<PurgeOldVersionsResponse> {
    return new Promise((resolve, reject) => {
      const request: PurgeOldVersionsRequest = {
        uid,
        keep_count: keepCount,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.PurgeOldVersions(request, (error: grpc.ServiceError, response: PurgeOldVersionsResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  triggerSync(user: string, tenant: string = 'default'): Promise<TriggerSyncResponse> {
    return new Promise((resolve, reject) => {
      const request: TriggerSyncRequest = {
        tenant,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.TriggerSync(request, (error: grpc.ServiceError, response: TriggerSyncResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }
}

export default FileEngineClient;