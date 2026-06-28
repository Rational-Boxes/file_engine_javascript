# FileEngine gRPC Client

> ⚠️ **Active development — not production-ready.** This project is under active development and should **not** be considered safe for mission-critical use.

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

> This client targets the `fileengine` protocol defined in
> `file_engine_cpp/proto/fileservice.proto`. Method names mirror the service
> RPCs (`CreateFile`, `WriteFile`, `ReadFile`, `MoveFile`, etc.).

### Directory Operations

#### makeDirectory(parentUid, name, user, tenant = 'default')
Creates a new directory.

#### removeDirectory(uid, user, tenant = 'default')
Removes a directory.

#### listDirectory(uid, user, includeDeleted = false, tenant = 'default')
Lists the contents of a directory. Pass `includeDeleted = true` to include
soft-deleted entries.

### File Operations

#### createFile(parentUid, name, user, tenant = 'default')
Creates an empty file.

#### deleteFile(uid, user, tenant = 'default')
Deletes a file.

#### undeleteFile(uid, user, tenant = 'default')
Undeletes a file.

#### writeFile(uid, data, user, tenant = 'default')
Writes data to a file (creates a new version).

#### readFile(uid, user, tenant = 'default')
Reads the latest content of a file.

### File Information

#### getFileInfo(uid, user, tenant = 'default')
Gets file or directory information.

#### fileExists(uid, user, tenant = 'default')
Checks if a file or directory exists.

### File Manipulation

#### renameFile(uid, newName, user, tenant = 'default')
Renames a file or directory.

#### moveFile(sourceUid, destinationUid, user, tenant = 'default')
Moves a file or directory into the destination directory.

#### copyFile(sourceUid, destinationUid, user, tenant = 'default')
Copies a file or directory into the destination directory.

### Version Operations

#### listVersions(uid, user, tenant = 'default')
Lists all version timestamps of a file.

#### readVersion(uid, versionTimestamp, user, tenant = 'default')
Reads a specific version of a file by its timestamp.

### Path Resolution

#### resolvePath(path, user, tenant = 'default')
Resolves an absolute path to its UID and type (`{ success, uid, type }`).

### Metadata Operations

#### setMetadata(uid, key, value, user, tenant = 'default')
Sets metadata for a resource.

#### getMetadata(uid, key, user, tenant = 'default')
Gets specific metadata for a resource.

#### getAllMetadata(uid, user, tenant = 'default')
Gets all metadata for a resource (returns `metadata` as an array of
`{ key, value }` entries).

#### deleteMetadata(uid, key, user, tenant = 'default')
Deletes specific metadata for a resource.

#### getMetadataForVersion(uid, version, key, user, tenant = 'default')
Gets specific metadata for a version of a resource (`version` is a numeric
version index).

#### getAllMetadataForVersion(uid, version, user, tenant = 'default')
Gets all metadata for a version of a resource (`version` is a numeric version
index).

### ACL Operations

#### grantPermission(resourceUid, principal, permission, effect = 'ALLOW')
Grants (or, with `effect='DENY'`, denies) a permission to a principal. The
`principal` selects the rule kind by prefix:
- a bare name targets a **user**;
- `role:<name>` targets a **role**;
- `claim:<key>=<value>` targets an **attribute-based (ABAC) claim** — the rule
  matches any requester whose auth claims contain that key/value pair.

#### checkPermission(resourceUid, permission, user?, roles?, claims?)
Returns a boolean decision. Pass `claims` (a `{ [key]: value }` map) so that
`claim:`-based rules can match the requester.

#### getEffectivePermissions(resourceUid, user?, roles?, claims?)
Resolves the principal's full effective permission set on a resource in one
call, without accessing the entity. Returns an array of permission strings.
`claims` feed `claim:`-based (ABAC) rule matching, so an external indexer gets
the same decision the filesystem would enforce.

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
    const fileResponse = await client.createFile(dirResponse.uid, 'my_file.txt', 'root');
    console.log('File created:', fileResponse.uid);

    // Write data to the file
    await client.writeFile(fileResponse.uid, 'Hello, FileEngine!', 'root');
    console.log('Data written to file');

    // Read data from the file
    const readResponse = await client.readFile(fileResponse.uid, 'root');
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
    const fileResponse = await client.createFile('', 'metadata_example.txt', 'root');
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

Copyright (C) 2026 James Hickman <james@rationalboxes.com>

This library is licensed under the **GNU Lesser General Public License, version 3
(or later)** — see the [LICENSE](LICENSE) file. The LGPL builds on the GPL, included
as [LICENSE.GPL-3.0](LICENSE.GPL-3.0).
