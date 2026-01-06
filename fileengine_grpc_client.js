const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

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
  constructor(serverAddress = 'localhost:50051') {
    this.client = new fileengine_rpc.FileService(
      serverAddress,
      grpc.credentials.createInsecure()
    );
  }

  // Helper function to create auth context
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
        auth: this.createAuthContext(user, [], tenant),
        permissions: 0o755
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

  listDirectory(uid, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        uid,
        auth: this.createAuthContext(user, [], tenant)
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

  listDirectoryWithDeleted(uid, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        uid,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.ListDirectoryWithDeleted(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  // File operations
  touch(parentUid, name, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        parent_uid: parentUid,
        name,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.Touch(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  removeFile(uid, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        uid,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.RemoveFile(request, (error, response) => {
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

  putFile(uid, data, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        uid,
        auth: this.createAuthContext(user, [], tenant),
        data: Buffer.isBuffer(data) ? data : Buffer.from(data)
      };

      this.client.PutFile(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  getFile(uid, user, versionTimestamp = null, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        uid,
        version_timestamp: versionTimestamp,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.GetFile(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  // File information
  stat(uid, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        uid,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.Stat(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  exists(uid, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        uid,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.Exists(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  // File manipulation operations
  rename(uid, newName, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        uid,
        new_name: newName,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.Rename(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  move(sourceUid, destinationParentUid, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        source_uid: sourceUid,
        destination_parent_uid: destinationParentUid,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.Move(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  copy(sourceUid, destinationParentUid, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        source_uid: sourceUid,
        destination_parent_uid: destinationParentUid,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.Copy(request, (error, response) => {
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

  getVersion(uid, versionTimestamp, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        uid,
        version_timestamp: versionTimestamp,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.GetVersion(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  restoreToVersion(uid, versionTimestamp, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        uid,
        version_timestamp: versionTimestamp,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.RestoreToVersion(request, (error, response) => {
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

  getMetadataForVersion(uid, versionTimestamp, key, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        uid,
        version_timestamp: versionTimestamp,
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

  getAllMetadataForVersion(uid, versionTimestamp, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        uid,
        version_timestamp: versionTimestamp,
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

  // ACL operations
  grantPermission(resourceUid, principal, permission, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        resource_uid: resourceUid,
        principal,
        permission,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.GrantPermission(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  revokePermission(resourceUid, principal, permission, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        resource_uid: resourceUid,
        principal,
        permission,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.RevokePermission(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  checkPermission(resourceUid, requiredPermission, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        resource_uid: resourceUid,
        required_permission: requiredPermission,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.CheckPermission(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  // Administrative operations
  getStorageUsage(user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        auth: this.createAuthContext(user, [], tenant),
        tenant
      };

      this.client.GetStorageUsage(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  purgeOldVersions(uid, keepCount, user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        uid,
        keep_count: keepCount,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.PurgeOldVersions(request, (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  triggerSync(user, tenant = 'default') {
    return new Promise((resolve, reject) => {
      const request = {
        tenant,
        auth: this.createAuthContext(user, [], tenant)
      };

      this.client.TriggerSync(request, (error, response) => {
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