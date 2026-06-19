const FileEngineClient = require('./fileengine_grpc_client');

// Test constants
const SERVER_ADDRESS = 'localhost:50051';
const TEST_USER = 'root';
const TEST_TENANT = 'default';

// Global variables to hold test UIDs
let testRootDirUid = '';
let testFileUid = '';
let testSubDirUid = '';

// Initialize the client
const client = new FileEngineClient(SERVER_ADDRESS);

console.log('Starting FileEngine gRPC client tests (fileengine protocol)...\n');

// Test helper function
function runTest(description, testFn) {
  return testFn()
    .then(() => {
      console.log(`✅ ${description}`);
      return true;
    })
    .catch((error) => {
      console.log(`❌ ${description}: ${error.message}`);
      return false;
    });
}

// A directory entry's type is carried as the ProtoFileType enum name
// (proto-loader is configured with enums: String).
function isDirectoryType(type) {
  return type === 'PROTO_DIRECTORY' || type === 1;
}

// Main test function
async function runAllTests() {
  let passedTests = 0;
  const totalTests = 25; // Update this number when adding/removing tests

  // Test 1: MakeDirectory
  const test1Result = await runTest('MakeDirectory - Create root test directory', async () => {
    const response = await client.makeDirectory('', 'test_root_dir', TEST_USER, TEST_TENANT);
    if (!response.success || !response.uid) {
      throw new Error('Failed to create directory or missing UID');
    }
    testRootDirUid = response.uid;
    console.log(`   - Created directory with UID: ${testRootDirUid}`);
  });
  if (test1Result) passedTests++;

  // Test 2: GetFileInfo on created directory
  const test2Result = await runTest('GetFileInfo - Get directory information', async () => {
    const response = await client.getFileInfo(testRootDirUid, TEST_USER, TEST_TENANT);
    if (!response.success || !response.info) {
      throw new Error('Failed to get directory info');
    }
    if (response.info.uid !== testRootDirUid) {
      throw new Error('Returned UID does not match expected');
    }
    console.log(`   - Directory name: ${response.info.name}, Size: ${response.info.size} bytes`);
  });
  if (test2Result) passedTests++;

  // Test 3: FileExists - Check if directory exists
  const test3Result = await runTest('FileExists - Check if directory exists', async () => {
    const response = await client.fileExists(testRootDirUid, TEST_USER, TEST_TENANT);
    if (!response.success || !response.exists) {
      throw new Error('Directory should exist but was not found');
    }
  });
  if (test3Result) passedTests++;

  // Test 4: CreateFile - Create a file in the directory
  const test4Result = await runTest('CreateFile - Create a test file', async () => {
    const response = await client.createFile(testRootDirUid, 'test_file.txt', TEST_USER, TEST_TENANT);
    if (!response.success || !response.uid) {
      throw new Error('Failed to create file or missing UID');
    }
    testFileUid = response.uid;
    console.log(`   - Created file with UID: ${testFileUid}`);
  });
  if (test4Result) passedTests++;

  // Test 5: WriteFile - Write content to the file
  const test5Result = await runTest('WriteFile - Write content to file', async () => {
    const testData = 'Hello, FileEngine!';
    const response = await client.writeFile(testFileUid, testData, TEST_USER, TEST_TENANT);
    if (!response.success) {
      throw new Error('Failed to write file content');
    }
  });
  if (test5Result) passedTests++;

  // Test 6: ReadFile - Read content from the file
  const test6Result = await runTest('ReadFile - Read content from file', async () => {
    const response = await client.readFile(testFileUid, TEST_USER, TEST_TENANT);
    if (!response.success || !response.data) {
      throw new Error('Failed to read file content');
    }
    const content = response.data.toString();
    if (content !== 'Hello, FileEngine!') {
      throw new Error(`Read content does not match. Expected: 'Hello, FileEngine!', Got: '${content}'`);
    }
    console.log(`   - File content: ${content}`);
  });
  if (test6Result) passedTests++;

  // Test 7: ListDirectory - List contents of root directory
  const test7Result = await runTest('ListDirectory - List contents of test directory', async () => {
    const response = await client.listDirectory(testRootDirUid, TEST_USER, false, TEST_TENANT);
    if (!response.success || !Array.isArray(response.entries)) {
      throw new Error('Failed to list directory contents');
    }
    if (response.entries.length !== 1 || response.entries[0].uid !== testFileUid) {
      throw new Error('Directory listing does not match expected content');
    }
    console.log(`   - Directory contains ${response.entries.length} item(s)`);
  });
  if (test7Result) passedTests++;

  // Test 8: MakeDirectory - Create a subdirectory
  const test8Result = await runTest('MakeDirectory - Create subdirectory', async () => {
    const response = await client.makeDirectory(testRootDirUid, 'test_subdir', TEST_USER, TEST_TENANT);
    if (!response.success || !response.uid) {
      throw new Error('Failed to create subdirectory or missing UID');
    }
    testSubDirUid = response.uid;
    console.log(`   - Created subdirectory with UID: ${testSubDirUid}`);
  });
  if (test8Result) passedTests++;

  // Test 9: RenameFile - Rename the file
  const test9Result = await runTest('RenameFile - Rename the test file', async () => {
    const response = await client.renameFile(testFileUid, 'renamed_test_file.txt', TEST_USER, TEST_TENANT);
    if (!response.success) {
      throw new Error('Failed to rename file');
    }
    console.log(`   - Successfully renamed file`);
  });
  if (test9Result) passedTests++;

  // Test 10: GetFileInfo - Get info for renamed file
  const test10Result = await runTest('GetFileInfo - Get info for renamed file', async () => {
    const response = await client.getFileInfo(testFileUid, TEST_USER, TEST_TENANT);
    if (!response.success || !response.info) {
      throw new Error('Failed to get renamed file info');
    }
    if (response.info.name !== 'renamed_test_file.txt') {
      throw new Error(`File name was not updated. Expected: 'renamed_test_file.txt', Got: '${response.info.name}'`);
    }
    console.log(`   - File name after rename: ${response.info.name}`);
  });
  if (test10Result) passedTests++;

  // Test 11: MoveFile - Move the file to subdirectory
  const test11Result = await runTest('MoveFile - Move file to subdirectory', async () => {
    const response = await client.moveFile(testFileUid, testSubDirUid, TEST_USER, TEST_TENANT);
    if (!response.success) {
      throw new Error('Failed to move file');
    }
    console.log(`   - Successfully moved file to subdirectory`);
  });
  if (test11Result) passedTests++;

  // Test 12: ListDirectory - List contents of subdirectory to verify move
  const test12Result = await runTest('ListDirectory - Verify file moved to subdirectory', async () => {
    const response = await client.listDirectory(testSubDirUid, TEST_USER, false, TEST_TENANT);
    if (!response.success || !Array.isArray(response.entries) || response.entries.length !== 1) {
      throw new Error('Failed to list subdirectory contents or unexpected number of entries');
    }
    if (response.entries[0].uid !== testFileUid) {
      throw new Error('File was not found in subdirectory after move');
    }
    console.log(`   - Subdirectory contains ${response.entries.length} item(s)`);
  });
  if (test12Result) passedTests++;

  // Test 13: ListDirectory - List contents of root to verify file removed
  const test13Result = await runTest('ListDirectory - Verify file removed from root directory', async () => {
    const response = await client.listDirectory(testRootDirUid, TEST_USER, false, TEST_TENANT);
    if (!response.success || !Array.isArray(response.entries) || response.entries.length !== 1) {
      throw new Error('Root directory should have only the subdirectory after move');
    }
    if (response.entries[0].uid !== testSubDirUid || !isDirectoryType(response.entries[0].type)) {
      throw new Error('Root directory does not contain expected subdirectory');
    }
    console.log(`   - Root directory now contains ${response.entries.length} item(s)`);
  });
  if (test13Result) passedTests++;

  // Test 14: CopyFile - Copy the file back to root directory
  const test14Result = await runTest('CopyFile - Copy file back to root directory', async () => {
    const response = await client.copyFile(testFileUid, testRootDirUid, TEST_USER, TEST_TENANT);
    if (!response.success) {
      throw new Error('Failed to copy file');
    }
    console.log(`   - Successfully copied file back to root directory`);
  });
  if (test14Result) passedTests++;

  // Test 15: ListDirectory - List contents of root to verify copy
  const test15Result = await runTest('ListDirectory - Verify file copied to root directory', async () => {
    const response = await client.listDirectory(testRootDirUid, TEST_USER, false, TEST_TENANT);
    if (!response.success || !Array.isArray(response.entries) || response.entries.length !== 2) {
      throw new Error('Root directory should have 2 items after copy (subdir + copied file)');
    }
    console.log(`   - Root directory now contains ${response.entries.length} item(s) after copy`);
  });
  if (test15Result) passedTests++;

  // Test 16: SetMetadata - Set metadata on the file
  const test16Result = await runTest('SetMetadata - Set metadata on file', async () => {
    const response = await client.setMetadata(testFileUid, 'author', 'test_user', TEST_USER, TEST_TENANT);
    if (!response.success) {
      throw new Error('Failed to set metadata');
    }
    console.log(`   - Successfully set metadata on file`);
  });
  if (test16Result) passedTests++;

  // Test 17: GetMetadata - Get specific metadata
  const test17Result = await runTest('GetMetadata - Get specific metadata', async () => {
    const response = await client.getMetadata(testFileUid, 'author', TEST_USER, TEST_TENANT);
    if (!response.success || response.value !== 'test_user') {
      throw new Error(`Failed to get metadata or incorrect value. Expected: 'test_user', Got: '${response.value}'`);
    }
    console.log(`   - Retrieved metadata: author = ${response.value}`);
  });
  if (test17Result) passedTests++;

  // Test 18: GetAllMetadata - Get all metadata (repeated MetadataEntry array)
  const test18Result = await runTest('GetAllMetadata - Get all metadata', async () => {
    const response = await client.getAllMetadata(testFileUid, TEST_USER, TEST_TENANT);
    if (!response.success || !Array.isArray(response.metadata)) {
      throw new Error('Failed to get all metadata or metadata is not an array');
    }
    const authorEntry = response.metadata.find((e) => e.key === 'author');
    if (!authorEntry || authorEntry.value !== 'test_user') {
      throw new Error('Missing expected metadata entry author=test_user');
    }
    console.log(`   - All metadata:`, response.metadata);
  });
  if (test18Result) passedTests++;

  // Test 19: DeleteMetadata - Delete specific metadata
  const test19Result = await runTest('DeleteMetadata - Delete specific metadata', async () => {
    const response = await client.deleteMetadata(testFileUid, 'author', TEST_USER, TEST_TENANT);
    if (!response.success) {
      throw new Error('Failed to delete metadata');
    }
    console.log(`   - Successfully deleted metadata from file`);
  });
  if (test19Result) passedTests++;

  // Test 20: GetMetadata - Verify metadata deletion
  const test20Result = await runTest('GetMetadata - Verify metadata deletion', async () => {
    try {
      const response = await client.getMetadata(testFileUid, 'author', TEST_USER, TEST_TENANT);
      // If we get here without error, the metadata should report not-found
      if (response.success && response.value) {
        throw new Error('Metadata should have been deleted but still exists');
      }
      console.log(`   - Confirmed metadata was deleted`);
    } catch (error) {
      // This is also acceptable if the server signals deletion via an error
      if (error.message.includes('not found')) {
        console.log(`   - Confirmed metadata was deleted`);
      } else {
        throw error;
      }
    }
  });
  if (test20Result) passedTests++;

  // Test 21: ListVersions - List file versions
  const test21Result = await runTest('ListVersions - List versions of the file', async () => {
    const response = await client.listVersions(testFileUid, TEST_USER, TEST_TENANT);
    if (!response.success || !Array.isArray(response.versions)) {
      throw new Error(`Failed to list versions: ${response.error || 'Unknown error'}`);
    }
    console.log(`   - File has ${response.versions.length} version(s)`);
  });
  if (test21Result) passedTests++;

  // Test 22: ResolvePath - Resolve a path to a UID
  const test22Result = await runTest('ResolvePath - Resolve root test directory path', async () => {
    const response = await client.resolvePath('/test_root_dir', TEST_USER, TEST_TENANT);
    if (!response.success) {
      throw new Error(`Failed to resolve path: ${response.error || 'Unknown error'}`);
    }
    console.log(`   - Resolved '/test_root_dir' to UID: ${response.uid} (type: ${response.type})`);
  });
  if (test22Result) passedTests++;

  // Test 23: EvaluateACL - Evaluate effective permissions on a resource
  const test23Result = await runTest('EvaluateACL - Evaluate permissions on file', async () => {
    const response = await client.evaluateACL(testFileUid, TEST_USER, TEST_TENANT);
    if (!response.success || !Array.isArray(response.permissions)) {
      throw new Error(`Failed to evaluate ACL: ${response.error || 'Unknown error'}`);
    }
    console.log(`   - Effective permissions: ${response.permissions.join(', ') || '(none)'}`);
  });
  if (test23Result) passedTests++;

  // Test 24: ListDirectory with deleted - include soft-deleted entries
  const test24Result = await runTest('ListDirectory - List directory including deleted items', async () => {
    const response = await client.listDirectory(testRootDirUid, TEST_USER, true, TEST_TENANT);
    if (!response.success) {
      throw new Error(`Failed to list directory with deleted items: ${response.error || 'Unknown error'}`);
    }
    console.log(`   - Listed directory with deleted items (count: ${response.entries.length})`);
  });
  if (test24Result) passedTests++;

  // Test 25: DeleteFile - Clean up by deleting the file
  const test25Result = await runTest('DeleteFile - Clean up test file', async () => {
    const response = await client.deleteFile(testFileUid, TEST_USER, TEST_TENANT);
    if (!response.success) {
      throw new Error('Failed to delete test file');
    }
    console.log(`   - Successfully deleted test file`);
  });
  if (test25Result) passedTests++;

  // Clean up remaining test directories
  try {
    await client.removeDirectory(testSubDirUid, TEST_USER, TEST_TENANT);
    console.log(`   - Cleaned up subdirectory`);
  } catch (error) {
    console.log(`   - Warning: Failed to clean up subdirectory: ${error.message}`);
  }

  try {
    await client.removeDirectory(testRootDirUid, TEST_USER, TEST_TENANT);
    console.log(`   - Cleaned up root test directory`);
  } catch (error) {
    console.log(`   - Warning: Failed to clean up root directory: ${error.message}`);
  }

  console.log(`\nTests completed: ${passedTests}/${totalTests} passed`);

  if (passedTests === totalTests) {
    console.log('\n🎉 All tests passed!');
  } else {
    console.log(`\n⚠️  ${totalTests - passedTests} test(s) failed.`);
  }
}

// Run the tests
runAllTests().catch(console.error);
