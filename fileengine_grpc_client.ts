import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as fs from 'fs';
import * as path from 'path';

// TypeScript interfaces mirroring file_engine_cpp/proto/fileservice.proto
// (package `fileengine`, service `FileService`).

interface AuthContext {
  user: string;
  roles: string[];
  tenant: string;
  claims: { [key: string]: string };
}

// Mirrors the proto `ProtoFileType` enum. proto-loader is configured with
// `enums: String`, so values are carried on the wire as the enum names.
enum ProtoFileType {
  PROTO_REGULAR_FILE = 'PROTO_REGULAR_FILE',
  PROTO_DIRECTORY = 'PROTO_DIRECTORY'
}

interface ProtoFileInfo {
  uid: string;
  path: string;
  name: string;
  type: ProtoFileType;
  size: number;
  created_at: number;
  modified_at: number;
  version: string;
  owner: string;
  permissions: number;
}

interface ProtoDirectoryEntry {
  uid: string;
  name: string;
  type: ProtoFileType;
  size: number;
  created_at: number;
  modified_at: number;
  version_count: number;
}

interface MetadataEntry {
  key: string;
  value: string;
}

// Directory operations
interface MakeDirectoryRequest {
  parent_uid: string;
  name: string;
  auth: AuthContext;
}

interface MakeDirectoryResponse {
  success: boolean;
  error?: string;
  uid?: string;
}

interface RemoveDirectoryRequest {
  uid: string;
  auth: AuthContext;
}

interface RemoveDirectoryResponse {
  success: boolean;
  error?: string;
}

interface ListDirectoryRequest {
  uid: string;
  auth: AuthContext;
  include_deleted: boolean;
}

interface ListDirectoryResponse {
  success: boolean;
  error?: string;
  entries: ProtoDirectoryEntry[];
}

// File operations
interface CreateFileRequest {
  parent_uid: string;
  name: string;
  auth: AuthContext;
}

interface CreateFileResponse {
  success: boolean;
  error?: string;
  uid?: string;
}

interface DeleteFileRequest {
  uid: string;
  auth: AuthContext;
}

interface DeleteFileResponse {
  success: boolean;
  error?: string;
}

interface UndeleteFileRequest {
  uid: string;
  auth: AuthContext;
}

interface UndeleteFileResponse {
  success: boolean;
  error?: string;
}

interface WriteFileRequest {
  uid: string;
  auth: AuthContext;
  data: Buffer;
}

interface WriteFileResponse {
  success: boolean;
  error?: string;
}

interface ReadFileRequest {
  uid: string;
  auth: AuthContext;
}

interface ReadFileResponse {
  success: boolean;
  error?: string;
  data?: Buffer;
}

interface GetFileInfoRequest {
  uid: string;
  auth: AuthContext;
}

interface GetFileInfoResponse {
  success: boolean;
  error?: string;
  info?: ProtoFileInfo;
}

interface FileExistsRequest {
  uid: string;
  auth: AuthContext;
}

interface FileExistsResponse {
  success: boolean;
  error?: string;
  exists: boolean;
}

// File manipulation
interface MoveFileRequest {
  source_uid: string;
  destination_uid: string;
  auth: AuthContext;
}

interface MoveFileResponse {
  success: boolean;
  error?: string;
}

interface CopyFileRequest {
  source_uid: string;
  destination_uid: string;
  auth: AuthContext;
}

interface CopyFileResponse {
  success: boolean;
  error?: string;
}

interface RenameFileRequest {
  uid: string;
  new_name: string;
  auth: AuthContext;
}

interface RenameFileResponse {
  success: boolean;
  error?: string;
}

// Version control
interface ListVersionsRequest {
  uid: string;
  auth: AuthContext;
}

interface ListVersionsResponse {
  success: boolean;
  error?: string;
  versions: string[];
}

interface ReadVersionRequest {
  uid: string;
  version_timestamp: string;
  auth: AuthContext;
}

interface ReadVersionResponse {
  success: boolean;
  error?: string;
  data?: Buffer;
}

// Metadata operations
interface SetMetadataRequest {
  uid: string;
  key: string;
  value: string;
  auth: AuthContext;
}

interface SetMetadataResponse {
  success: boolean;
  error?: string;
}

interface GetMetadataRequest {
  uid: string;
  key: string;
  auth: AuthContext;
}

interface GetMetadataResponse {
  success: boolean;
  error?: string;
  value?: string;
}

interface GetAllMetadataRequest {
  uid: string;
  auth: AuthContext;
}

interface GetAllMetadataResponse {
  success: boolean;
  error?: string;
  metadata: MetadataEntry[];
}

interface DeleteMetadataRequest {
  uid: string;
  key: string;
  auth: AuthContext;
}

interface DeleteMetadataResponse {
  success: boolean;
  error?: string;
}

interface GetMetadataForVersionRequest {
  uid: string;
  version: number;
  key: string;
  auth: AuthContext;
}

interface GetMetadataForVersionResponse {
  success: boolean;
  error?: string;
  value?: string;
}

interface GetAllMetadataForVersionRequest {
  uid: string;
  version: number;
  auth: AuthContext;
}

interface GetAllMetadataForVersionResponse {
  success: boolean;
  error?: string;
  metadata: MetadataEntry[];
}

// Path resolution
interface ResolvePathRequest {
  path: string;
  auth: AuthContext;
}

interface ResolvePathResponse {
  success: boolean;
  error?: string;
  uid?: string;
  type?: ProtoFileType;
}

// ACL operations
interface EvaluateACLRequest {
  uid: string;
  auth: AuthContext;
}

interface EvaluateACLResponse {
  success: boolean;
  error?: string;
  permissions: string[];
}

// Load the proto file (canonical fileengine protocol from the C++ server).
// Resolve across run-from-source (root) and compiled (dist/) layouts, plus a
// proto bundled alongside the client (e.g. RPM-packaged deployments).
function resolveProtoPath(): string {
  const candidates = [
    path.join(__dirname, '../file_engine_cpp/proto/fileservice.proto'),
    path.join(__dirname, '../../file_engine_cpp/proto/fileservice.proto'),
    path.join(__dirname, 'fileservice.proto'),
    path.join(__dirname, '../fileservice.proto')
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

const PROTO_PATH = resolveProtoPath();

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

const fileengine: any = grpc.loadPackageDefinition(packageDefinition).fileengine;

class FileEngineClient {
  private client: any;

  constructor(serverAddress: string = 'localhost:50051') {
    this.client = new fileengine.FileService(
      serverAddress,
      grpc.credentials.createInsecure()
    );
  }

  // Helper function to create the trusted-access auth context. User identity
  // is resolved by the front-end adapter and passed through verbatim.
  private createAuthContext(user: string, roles: string[] = [], tenant: string = 'default', claims: { [key: string]: string } = {}): AuthContext {
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
        auth: this.createAuthContext(user, [], tenant)
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

  listDirectory(uid: string, user: string, includeDeleted: boolean = false, tenant: string = 'default'): Promise<ListDirectoryResponse> {
    return new Promise((resolve, reject) => {
      const request: ListDirectoryRequest = {
        uid,
        auth: this.createAuthContext(user, [], tenant),
        include_deleted: includeDeleted
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

  // File operations
  createFile(parentUid: string, name: string, user: string, tenant: string = 'default'): Promise<CreateFileResponse> {
    return new Promise((resolve, reject) => {
      const request: CreateFileRequest = {
        parent_uid: parentUid,
        name,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.CreateFile(request, (error: grpc.ServiceError, response: CreateFileResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  deleteFile(uid: string, user: string, tenant: string = 'default'): Promise<DeleteFileResponse> {
    return new Promise((resolve, reject) => {
      const request: DeleteFileRequest = {
        uid,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.DeleteFile(request, (error: grpc.ServiceError, response: DeleteFileResponse) => {
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

  writeFile(uid: string, data: Buffer | string, user: string, tenant: string = 'default'): Promise<WriteFileResponse> {
    return new Promise((resolve, reject) => {
      const request: WriteFileRequest = {
        uid,
        auth: this.createAuthContext(user, [], tenant),
        data: Buffer.isBuffer(data) ? data : Buffer.from(data)
      };

      this.client.WriteFile(request, (error: grpc.ServiceError, response: WriteFileResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  readFile(uid: string, user: string, tenant: string = 'default'): Promise<ReadFileResponse> {
    return new Promise((resolve, reject) => {
      const request: ReadFileRequest = {
        uid,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.ReadFile(request, (error: grpc.ServiceError, response: ReadFileResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  // File information
  getFileInfo(uid: string, user: string, tenant: string = 'default'): Promise<GetFileInfoResponse> {
    return new Promise((resolve, reject) => {
      const request: GetFileInfoRequest = {
        uid,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.GetFileInfo(request, (error: grpc.ServiceError, response: GetFileInfoResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  fileExists(uid: string, user: string, tenant: string = 'default'): Promise<FileExistsResponse> {
    return new Promise((resolve, reject) => {
      const request: FileExistsRequest = {
        uid,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.FileExists(request, (error: grpc.ServiceError, response: FileExistsResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  // File manipulation operations
  renameFile(uid: string, newName: string, user: string, tenant: string = 'default'): Promise<RenameFileResponse> {
    return new Promise((resolve, reject) => {
      const request: RenameFileRequest = {
        uid,
        new_name: newName,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.RenameFile(request, (error: grpc.ServiceError, response: RenameFileResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  moveFile(sourceUid: string, destinationUid: string, user: string, tenant: string = 'default'): Promise<MoveFileResponse> {
    return new Promise((resolve, reject) => {
      const request: MoveFileRequest = {
        source_uid: sourceUid,
        destination_uid: destinationUid,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.MoveFile(request, (error: grpc.ServiceError, response: MoveFileResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  copyFile(sourceUid: string, destinationUid: string, user: string, tenant: string = 'default'): Promise<CopyFileResponse> {
    return new Promise((resolve, reject) => {
      const request: CopyFileRequest = {
        source_uid: sourceUid,
        destination_uid: destinationUid,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.CopyFile(request, (error: grpc.ServiceError, response: CopyFileResponse) => {
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

  readVersion(uid: string, versionTimestamp: string, user: string, tenant: string = 'default'): Promise<ReadVersionResponse> {
    return new Promise((resolve, reject) => {
      const request: ReadVersionRequest = {
        uid,
        version_timestamp: versionTimestamp,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.ReadVersion(request, (error: grpc.ServiceError, response: ReadVersionResponse) => {
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

  getMetadataForVersion(uid: string, version: number, key: string, user: string, tenant: string = 'default'): Promise<GetMetadataForVersionResponse> {
    return new Promise((resolve, reject) => {
      const request: GetMetadataForVersionRequest = {
        uid,
        version,
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

  getAllMetadataForVersion(uid: string, version: number, user: string, tenant: string = 'default'): Promise<GetAllMetadataForVersionResponse> {
    return new Promise((resolve, reject) => {
      const request: GetAllMetadataForVersionRequest = {
        uid,
        version,
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

  // Path resolution
  resolvePath(path: string, user: string, tenant: string = 'default'): Promise<ResolvePathResponse> {
    return new Promise((resolve, reject) => {
      const request: ResolvePathRequest = {
        path,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.ResolvePath(request, (error: grpc.ServiceError, response: ResolvePathResponse) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  // ACL operations
  evaluateACL(uid: string, user: string, tenant: string = 'default'): Promise<EvaluateACLResponse> {
    return new Promise((resolve, reject) => {
      const request: EvaluateACLRequest = {
        uid,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.EvaluateACL(request, (error: grpc.ServiceError, response: EvaluateACLResponse) => {
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
export { ProtoFileType };
