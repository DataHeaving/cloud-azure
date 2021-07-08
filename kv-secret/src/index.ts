import * as id from "@azure/core-auth";
import * as http from "@azure/core-http";
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
      .filter((seg) => seg.length > 0); // The resulting array should be typically ["secrets", "<secret name>", "<possibly secret version>"]
    if (pathSegments.length < 2) {
      throw new MalformedSecretURLError(url);
    }
    return {
      kvURL: url.origin,
      secretName: pathSegments[1],
      secretVersion: pathSegments.length > 2 ? pathSegments[2] : undefined,
    };
  };
  const secretReference =
    typeof secretReferenceOrURL === "string" ||
    secretReferenceOrURL instanceof URL
      ? getKVURLAndSecretParamsFromSecretURL(secretReferenceOrURL)
      : secretReferenceOrURL;
  const { kvURL, secretName, secretVersion } = secretReference;
  try {
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
  } catch (e) {
    throw e instanceof http.RestError && (e.code as unknown) === 404 // Crappy typings - .code is really a number
      ? new SecretDoesNotExistError(secretReference)
      : e;
  }
};

export const getSecretValue = async (
  ...params: Parameters<typeof getSecret>
) => {
  const {
    secret: { value },
  } = await getSecret(...params);
  return value;
};

// notice: this will throw also on empty secret
export const getMandatorySecretValue = async (
  ...params: Parameters<typeof getSecret>
) => {
  const {
    secretReference,
    secret: { value },
  } = await getSecret(...params);
  if (!value) {
    throw new SecretDoesNotExistError(secretReference);
  }

  return value;
};

export class SecretDoesNotExistError extends Error {
  public constructor(
    public readonly secretReference: common.DeepReadOnly<KeyvaultSecretReference>,
  ) {
    super(`Failed to get secret value from KV secret reference.`);
  }
}

export class MalformedSecretURLError extends Error {
  public constructor(public readonly url: URL) {
    super(`Failed to resolve secret name from URL.`);
  }
}
