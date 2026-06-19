const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const fs = require('fs');
const path = require('path');

// Load the proto file (canonical `fileengine` protocol from the C++ server).
// Resolve across run-from-source and packaged layouts.
function resolveProtoPath() {
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

const fileengine = grpc.loadPackageDefinition(packageDefinition).fileengine;

class FileEngineClient {
  constructor(serverAddress = 'localhost:50051') {
    this.client = new fileengine.FileService(
      serverAddress,
      grpc.credentials.createInsecure()
    );
  }

  // Helper function to create the trusted-access auth context. User identity is
  // resolved by the front-end adapter and passed through verbatim.
  createAuthContext(user, roles = [], tenant = 'default', claims = {}) {
    return {
      user,
      roles,
      tenant,
      claims
    };
  }

  // Directory operations
  makeDirectory(parentUid, name, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        parent_uid: parentUid,
        name,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.MakeDirectory(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  removeDirectory(uid, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        uid,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.RemoveDirectory(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  listDirectory(uid, user, includeDeleted = false, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        uid,
        auth: this.createAuthContext(user, [], tenant),
        include_deleted: includeDeleted
      };

      this.client.ListDirectory(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  // File operations
  createFile(parentUid, name, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        parent_uid: parentUid,
        name,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.CreateFile(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  deleteFile(uid, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        uid,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.DeleteFile(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  undeleteFile(uid, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        uid,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.UndeleteFile(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  writeFile(uid, data, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        uid,
        auth: this.createAuthContext(user, [], tenant),
        data: Buffer.isBuffer(data) ? data : Buffer.from(data)
      };

      this.client.WriteFile(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  readFile(uid, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        uid,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.ReadFile(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  // File information
  getFileInfo(uid, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        uid,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.GetFileInfo(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  fileExists(uid, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        uid,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.FileExists(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  // File manipulation operations
  renameFile(uid, newName, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        uid,
        new_name: newName,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.RenameFile(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  moveFile(sourceUid, destinationUid, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        source_uid: sourceUid,
        destination_uid: destinationUid,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.MoveFile(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  copyFile(sourceUid, destinationUid, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        source_uid: sourceUid,
        destination_uid: destinationUid,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.CopyFile(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  // Version operations
  listVersions(uid, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        uid,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.ListVersions(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  readVersion(uid, versionTimestamp, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        uid,
        version_timestamp: versionTimestamp,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.ReadVersion(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  // Metadata operations
  setMetadata(uid, key, value, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        uid,
        key,
        value,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.SetMetadata(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  getMetadata(uid, key, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        uid,
        key,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.GetMetadata(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  getAllMetadata(uid, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        uid,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.GetAllMetadata(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  deleteMetadata(uid, key, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        uid,
        key,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.DeleteMetadata(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  getMetadataForVersion(uid, version, key, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        uid,
        version,
        key,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.GetMetadataForVersion(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  getAllMetadataForVersion(uid, version, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        uid,
        version,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.GetAllMetadataForVersion(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  // Path resolution
  resolvePath(filePath, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        path: filePath,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.ResolvePath(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  // ACL operations
  evaluateACL(uid, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        uid,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.EvaluateACL(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }
}

module.exports = FileEngineClient;
module.exports.default = FileEngineClient;
