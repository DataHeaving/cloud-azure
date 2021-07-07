import * as id from "@azure/core-auth";
import * as kv from "@azure/keyvault-secrets";
import * as common from "@data-heaving/common";
import { URL } from "url";

export interface KeyvaultSecretReference {
  kvURL: string;
  secretName: string;
  secretVersion?: string;
}
export type KevaultSecretReferenceOrURL =
  | string // URL of secret, possibly with version
  | URL // URL of secret, possibly with version
  | {
      kvURL: string;
      secretName: string;
      secretVersion?: string;
    };

export const getSecret = async (
  auth: id.TokenCredential,
  secretReferenceOrURL: KevaultSecretReferenceOrURL,
) => {
  const getKVURLAndSecretParamsFromSecretURL = (secretURL: string | URL) => {
    const url = typeof secretURL === "string" ? new URL(secretURL) : secretURL;
    const pathSegments = url.pathname
      .split("/")
      .filter((seg) => seg.length > 0); // The resulting array will be typically ["secrets", "<secret name>", "<possibly secret version>"]
    const secretNameIndex = pathSegments[0].toLowerCase() === "secrets" ? 1 : 0;
    const secretVersionIndex = secretNameIndex + 1;
    return {
      kvURL: url.origin,
      secretName: pathSegments[secretNameIndex],
      secretVersion:
        pathSegments.length > secretVersionIndex
          ? pathSegments[secretVersionIndex]
          : undefined,
    };
  };
  const secretReference =
    typeof secretReferenceOrURL === "string" ||
    secretReferenceOrURL instanceof URL
      ? getKVURLAndSecretParamsFromSecretURL(secretReferenceOrURL)
      : secretReferenceOrURL;
  const { kvURL, secretName, secretVersion } = secretReference;
  return {
    secretReference,
    secret: await new kv.SecretClient(kvURL, auth).getSecret(
      secretName,
      secretVersion
        ? {
            version: secretReference.secretVersion,
          }
        : undefined,
    ),
  };
};

export const getSecretValue = async (
  auth: id.TokenCredential,
  secretReferenceOrURL: KevaultSecretReferenceOrURL,
) => {
  const {
    secret: { value },
  } = await getSecret(auth, secretReferenceOrURL);
  return value;
};

export const getMandatorySecretValue = async (
  auth: id.TokenCredential,
  secretReferenceOrURL: KevaultSecretReferenceOrURL,
) => {
  const {
    secretReference,
    secret: { value },
  } = await getSecret(auth, secretReferenceOrURL);
  if (!value) {
    throw new SecretDoesNotExistError(secretReference);
  }

  return value;
};

export class SecretDoesNotExistError extends Error {
  public constructor(
    public readonly secretReference: common.DeepReadOnly<KeyvaultSecretReference>,
  ) {
    super(
      `Failed to get password from KV secret reference: ${JSON.stringify(
        secretReference,
      )}.`,
    );
  }
}
