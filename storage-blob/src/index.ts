import * as storage from "@azure/storage-blob";
import * as id from "@azure/core-auth";
import * as common from "@data-heaving/common";

export type BlobClientOrInfo<TBlobClient extends storage.BlobClient> =
  | TBlobClient
  | BlobClientConstructionInfo;

export interface BlobClientConstructionInfo {
  url: string;
  credential:
    | storage.StorageSharedKeyCredential
    | storage.AnonymousCredential
    | id.TokenCredential;
}

export function createObjectStorageFunctionality<TObject>(
  blobOrURL: BlobClientOrInfo<storage.BlockBlobClient>,
): common.ObjectStorageFunctionality<TObject> {
  const blobClient =
    blobOrURL instanceof storage.BlockBlobClient
      ? blobOrURL
      : new storage.BlockBlobClient(blobOrURL.url, blobOrURL.credential);
  return {
    storageID: blobClient.url,
    readExistingData: () => blobClient.downloadToBuffer(),
    writeNewData: async (data) => {
      await blobClient.uploadData(
        data instanceof Buffer ? data : Buffer.from(JSON.stringify(data)),
      );
    },
  };
}

export function createReadonlyObjectStorageFunctionality<TObject>(
  blobOrURL: BlobClientOrInfo<storage.BlobClient>,
): Omit<common.ObjectStorageFunctionality<TObject>, "writeNewData"> {
  const blobClient =
    blobOrURL instanceof storage.BlobClient
      ? blobOrURL
      : new storage.BlobClient(blobOrURL.url, blobOrURL.credential);
  return {
    storageID: blobClient.url,
    readExistingData: () => blobClient.downloadToBuffer(),
  };
}

export const escapeForBlobPath = (str: string) =>
  str.replace(/[/ ]/gi, (badChar) => `¤${badChar.codePointAt(0)}`);
// .toLowerCase();

export const unescapeFromBlobPath = (path: string) =>
  path.replace(/¤(\d\d)/gi, (matchedString) =>
    String.fromCodePoint(Number.parseInt(matchedString.substr(1))),
  );
