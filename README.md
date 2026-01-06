# FileEngine gRPC Client

A JavaScript and TypeScript client for the FileEngine virtual filesystem gRPC service.

## Installation

```bash
npm install fileengine-grpc-client
```

## Usage

### JavaScript

```javascript
const FileEngineClient = require('fileengine-grpc-client');

// Create a client instance
const client = new FileEngineClient('localhost:50051'); // Default server address

// Example: Create a directory
async function example() {
  try {
    const response = await client.makeDirectory('', 'my_new_directory', 'root', 'default');
    console.log('Directory created:', response);
  } catch (error) {
    console.error('Error:', error);
  }
}

example();
```

### TypeScript

```typescript
import FileEngineClient from 'fileengine-grpc-client';

// Create a client instance
const client = new FileEngineClient('localhost:50051'); // Default server address

// Example: Create a directory
async function example() {
  try {
    const response = await client.makeDirectory('', 'my_new_directory', 'root', 'default');
    console.log('Directory created:', response);
  } catch (error) {
    console.error('Error:', error);
  }
}

example();
```

## API Reference

### Constructor
```javascript
new FileEngineClient(serverAddress = 'localhost:50051')
```

### Authentication Context
All operations require an authentication context with:
- `user`: The username (e.g., 'root' for superuser)
- `tenant`: The tenant name (default: 'default')
- `roles`: Array of user roles (optional)
- `claims`: Additional user claims (optional)

### Directory Operations

#### makeDirectory(parentUid, name, user, tenant = 'default')
Creates a new directory.

#### removeDirectory(uid, user, tenant = 'default')
Removes a directory.

#### listDirectory(uid, user, tenant = 'default')
Lists the contents of a directory.

#### listDirectoryWithDeleted(uid, user, tenant = 'default')
Lists the contents of a directory including deleted files.

### File Operations

#### touch(parentUid, name, user, tenant = 'default')
Creates an empty file.

#### removeFile(uid, user, tenant = 'default')
Removes a file.

#### undeleteFile(uid, user, tenant = 'default')
Undeletes a file.

#### putFile(uid, data, user, tenant = 'default')
Uploads data to a file.

#### getFile(uid, user, versionTimestamp = null, tenant = 'default')
Downloads data from a file.

### File Information

#### stat(uid, user, tenant = 'default')
Gets file or directory information.

#### exists(uid, user, tenant = 'default')
Checks if a file or directory exists.

### File Manipulation

#### rename(uid, newName, user, tenant = 'default')
Renames a file or directory.

#### move(sourceUid, destinationParentUid, user, tenant = 'default')
Moves a file or directory.

#### copy(sourceUid, destinationParentUid, user, tenant = 'default')
Copies a file or directory.

### Version Operations

#### listVersions(uid, user, tenant = 'default')
Lists all versions of a file.

#### getVersion(uid, versionTimestamp, user, tenant = 'default')
Gets a specific version of a file.

#### restoreToVersion(uid, versionTimestamp, user, tenant = 'default')
Restores a file to a specific version.

### Metadata Operations

#### setMetadata(uid, key, value, user, tenant = 'default')
Sets metadata for a resource.

#### getMetadata(uid, key, user, tenant = 'default')
Gets specific metadata for a resource.

#### getAllMetadata(uid, user, tenant = 'default')
Gets all metadata for a resource.

#### deleteMetadata(uid, key, user, tenant = 'default')
Deletes specific metadata for a resource.

#### getMetadataForVersion(uid, versionTimestamp, key, user, tenant = 'default')
Gets specific metadata for a specific version of a resource.

#### getAllMetadataForVersion(uid, versionTimestamp, user, tenant = 'default')
Gets all metadata for a specific version of a resource.

### ACL Operations

#### grantPermission(resourceUid, principal, permission, user, tenant = 'default')
Grants a permission to a principal on a resource.

#### revokePermission(resourceUid, principal, permission, user, tenant = 'default')
Revokes a permission from a principal on a resource.

#### checkPermission(resourceUid, requiredPermission, user, tenant = 'default')
Checks if a user has a specific permission on a resource.

### Administrative Operations

#### getStorageUsage(user, tenant = 'default')
Gets storage usage statistics.

#### purgeOldVersions(uid, keepCount, user, tenant = 'default')
Purges old versions of a file, keeping only the specified number.

#### triggerSync(user, tenant = 'default')
Triggers synchronization.

## Permissions

The following permissions are available:
- `Permission.READ` - Read permission
- `Permission.WRITE` - Write permission
- `Permission.DELETE` - Delete permission
- `Permission.LIST_DELETED` - List deleted items permission
- `Permission.UNDELETE` - Undelete permission
- `Permission.VIEW_VERSIONS` - View versions permission
- `Permission.RETRIEVE_BACK_VERSION` - Retrieve back version permission
- `Permission.RESTORE_TO_VERSION` - Restore to version permission
- `Permission.EXECUTE` - Execute permission

## Examples

### Creating a directory and file

```javascript
const client = new FileEngineClient();

async function createDirAndFile() {
  try {
    // Create a directory
    const dirResponse = await client.makeDirectory('', 'my_directory', 'root');
    console.log('Directory created:', dirResponse.uid);

    // Create a file in the directory
    const fileResponse = await client.touch(dirResponse.uid, 'my_file.txt', 'root');
    console.log('File created:', fileResponse.uid);

    // Write data to the file
    await client.putFile(fileResponse.uid, 'Hello, FileEngine!', 'root');
    console.log('Data written to file');

    // Read data from the file
    const readResponse = await client.getFile(fileResponse.uid, 'root');
    console.log('File content:', readResponse.data.toString());
  } catch (error) {
    console.error('Error:', error);
  }
}

createDirAndFile();
```

### Setting and getting metadata

```javascript
const client = new FileEngineClient();

async function metadataExample() {
  try {
    // Create a file
    const fileResponse = await client.touch('', 'metadata_example.txt', 'root');
    const fileUid = fileResponse.uid;

    // Set metadata
    await client.setMetadata(fileUid, 'author', 'John Doe', 'root');
    await client.setMetadata(fileUid, 'version', '1.0', 'root');
    console.log('Metadata set');

    // Get specific metadata
    const authorResponse = await client.getMetadata(fileUid, 'author', 'root');
    console.log('Author:', authorResponse.value);

    // Get all metadata
    const allMetadataResponse = await client.getAllMetadata(fileUid, 'root');
    console.log('All metadata:', allMetadataResponse.metadata);
  } catch (error) {
    console.error('Error:', error);
  }
}

metadataExample();
```

## Testing

To test the client, make sure the FileEngine gRPC server is running at `localhost:50051` and use the `root` superuser as specified in the requirements.

## License

MIT