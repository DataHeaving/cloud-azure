import * as storage from "@azure/storage-blob";
import * as common from "@data-heaving/common";
import test, { ExecutionContext } from "ava";
import * as spec from "..";

test("Escaping and unescaping works for strings containing only valid characters", (t) => {
  const testString = "MyTestString";
  const escaped = spec.escapeForBlobPath(testString);
  t.deepEqual(escaped, testString);
  t.deepEqual(spec.unescapeFromBlobPath(escaped), testString);
});

test("Escaping and unescaping works for strings contaiing also invalid characters", (t) => {
  const testString = "My/TestString";
  const escaped = spec.escapeForBlobPath(testString);
  t.deepEqual(escaped, "My¤47TestString");
  t.deepEqual(spec.unescapeFromBlobPath(escaped), testString);
});

test("Storage ID string matches blob URL", async (t) => {
  await performAzureBlobStorageTestForAllParameters(
    t,
    true,
    spec.createObjectStorageFunctionality,
  );
  await performAzureBlobStorageTestForAllParameters(
    t,
    false,
    spec.createReadonlyObjectStorageFunctionality,
  );
});

const performAzureBlobStorageTestForAllParameters = async (
  t: ExecutionContext,
  shouldHaveWrite: boolean,
  factory: (
    ...args: Parameters<typeof spec.createObjectStorageFunctionality>
  ) => common.MakeOptional<
    common.ObjectStorageFunctionality<unknown>,
    "writeNewData"
  >,
) => {
  const url = "https://no-no/dummy/dummy.json";
  await Promise.all([
    performAzureBlobStorageTest(t, shouldHaveWrite, factory, {
      url,
      credential: new storage.AnonymousCredential(),
    }),
    performAzureBlobStorageTest(
      t,
      shouldHaveWrite,
      factory,
      new storage.BlockBlobClient(url),
    ),
  ]);
};

const performAzureBlobStorageTest = async (
  t: ExecutionContext,
  shouldHaveWrite: boolean,
  factory: (
    ...args: Parameters<typeof spec.createObjectStorageFunctionality>
  ) => common.MakeOptional<
    common.ObjectStorageFunctionality<unknown>,
    "writeNewData"
  >,
  ...args: Parameters<typeof spec.createObjectStorageFunctionality>
) => {
  const { storageID, readExistingData, writeNewData } = factory(...args);
  t.deepEqual(
    storageID,
    args[0] instanceof storage.BlobClient ? args[0].url : args[0].url,
    `The storage ID returned by ${
      shouldHaveWrite ? "writeable" : "readonly"
    } storage must match given blob URL.`,
  );
  t.true(
    shouldHaveWrite === !!writeNewData,
    `Write method must${shouldHaveWrite ? "" : " not"} be present.`,
  );
  // Since we don't have actual blob where to read/write, assert that methods throw
  await t.throwsAsync(readExistingData);
  if (writeNewData) {
    await t.throwsAsync(() => writeNewData(Buffer.from("")));
    await t.throwsAsync(() => writeNewData(""));
  }
};
