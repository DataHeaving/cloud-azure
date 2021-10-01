import "cross-fetch";
import "cross-fetch/polyfill";
import * as graph from "@microsoft/microsoft-graph-client";
import * as validation from "@data-heaving/common-validation";
import * as common from "@data-heaving/common";
import * as crypto from "crypto";
import * as uuid from "uuid";
import { isDeepStrictEqual } from "util";
import * as types from "./types";
import * as utils from "./utils";

export const appGraphApi = "/applications";
export const getOrCreateApplicationWithDisplayName = async (
  client: graph.Client,
  applicationName: string,
) => {
  // Don't cache result of client.api as it is stateful
  // TODO fallback to list-owned-objects ( https://docs.microsoft.com/en-us/graph/api/serviceprincipal-list-ownedobjects?view=graph-rest-1.0&tabs=http ) if we get:
  // statusCode: 403,
  // code: 'Authorization_RequestDenied',
  // body: '{"code":"Authorization_RequestDenied","message":"Insufficient privileges to complete the operation.","innerError":{"date":"2021-09-11T08:43:56","request-id":"9bf79d05-2480-4e88-afaa-68f0825c969b","client-request-id":"d42c428b-0789-f35e-040a-d8ef199f3296"}}'
  const existingApp = validation.decodeOrThrow(
    utils.graphAPIListOf(types.application).decode,
    await client
      .api(appGraphApi)
      .filter(`displayName eq '${applicationName}'`)
      .get(),
  ).value[0];
  const application =
    existingApp ??
    validation.decodeOrThrow(
      types.application.decode,
      await client.api(appGraphApi).post({
        displayName: applicationName,
      }),
    );
  return application;
};

export const tryGetApplicationByDisplayName = async (
  client: graph.Client,
  applicationName: string,
): Promise<types.Application | undefined> =>
  validation.decodeOrThrow(
    utils.graphAPIListOf(types.application).decode,
    await client
      .api(appGraphApi)
      .filter(`displayName eq '${applicationName}'`)
      .get(),
  ).value[0];

export const tryGetApplicationByID = async (
  client: graph.Client,
  applicationId: string,
): Promise<types.Application | undefined> => {
  try {
    return validation.decodeOrThrow(
      types.application.decode,
      await client.api(`${appGraphApi}/${applicationId}`).get(),
    );
  } catch (e) {
    if (!(e instanceof graph.GraphError && e.statusCode === 404)) {
      throw e;
    }
  }
};

export const getOrCreateCertificateAuthentication = async (
  client: graph.Client,
  application: types.Application,
  certificatePem: string,
) => {
  const { id, keyCredentials } = application;
  const certificatePattern =
    /(-+BEGIN CERTIFICATE-+)(\n\r?|\r\n?)([A-Za-z0-9+/\n\r]+=*)(\n\r?|\r\n?)(-+END CERTIFICATE-+)/;
  const firstCertBase64 = certificatePattern.exec(certificatePem)?.[3];
  if (!firstCertBase64) {
    throw new Error(
      "Invalid certificate PEM contents, make sure BEGIN CERTIFICATE and END CERTIFICATE pre- and suffixes are present.",
    );
  }

  const customKeyIdentifier = crypto
    .createHash("sha1")
    .update(Buffer.from(firstCertBase64, "base64"))
    .digest("hex")
    .toUpperCase();
  const existingKey = keyCredentials.find(
    (keyCredential) =>
      keyCredential.customKeyIdentifier === customKeyIdentifier,
  );
  const createNew = !existingKey;
  const credential: types.CredentialUpdateInfo = existingKey ?? {
    type: "AsymmetricX509Cert",
    usage: "Verify",
    keyId: uuid.v4(),
    key: Buffer.from(certificatePem).toString("base64"),
    customKeyIdentifier,
  };

  if (createNew) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { customKeyIdentifier: _, ...credentialToPassToApi } = credential;
    // Please notice, the tricky part about /applications/${appId}/addKey, from https://docs.microsoft.com/en-us/graph/api/application-addkey?view=graph-rest-1.0&tabs=javascript
    // "Applications that don’t have any existing valid certificates (no certificates have been added yet, or all certificates have expired), won’t be able to use this service action. You can use the Update application operation to perform an update instead."
    await client.api(`${appGraphApi}/${id}`).patch({
      keyCredentials: [...keyCredentials, credentialToPassToApi],
    });
  }

  return {
    createNew,
    credential,
  };
};

export const ensureAppRequiredResourceAccess = async (
  client: graph.Client,
  application: types.Application,
  appRequiredPermissions: Array<types.ApplicationRequiredResourceAccess>,
) => {
  const { id } = application;
  const patchableAccess = createPatchableRequiredAccessArray(
    application.requiredResourceAccess,
    appRequiredPermissions,
  );
  const createNew = patchableAccess.length > 0;

  if (createNew) {
    await client.api(`${appGraphApi}/${id}`).patch({
      requiredResourceAccess: patchableAccess,
    });
  }

  return patchableAccess;
};

interface AppPermissionAddInfo {
  indexToRemove: number;
  accessToAdd: types.ApplicationRequiredResourceAccess;
}

const createPatchableRequiredAccessArray = (
  existingPermissions: ReadonlyArray<types.ApplicationRequiredResourceAccess>,
  additionalPermissions: ReadonlyArray<types.ApplicationRequiredResourceAccess>,
) => {
  const permissionAddInfos: Array<AppPermissionAddInfo> = [];
  // One can get all possible permissions via https://graph.windows.net/myorganization/applicationRefs/00000003-0000-0000-c000-000000000000?api-version=2.0&lang=en
  // And then examining items in "oauth2Permissions" array
  // Notice!!!! the Pulumi azuread provider uses azure-sdk-for-go, which underneath uses graphrbac, which underneath uses legacy Azure AD Graph endpoint ( https://graph.windows.net/ )!
  // This is why we must, instead of adding Microsoft Graph permissions, add Azure AD Graph permissions!
  for (const additionalPermission of additionalPermissions) {
    addToPatchablePermissions(
      existingPermissions,
      permissionAddInfos,
      additionalPermission,
    );
  }
  const patchableAccess: Array<types.ApplicationRequiredResourceAccess> = [];
  if (permissionAddInfos.length > 0) {
    const deduplicatedAdditionalPermissions = common.deduplicate(
      permissionAddInfos,
      ({ indexToRemove }) => `${indexToRemove}`,
    );
    if (deduplicatedAdditionalPermissions.length < permissionAddInfos.length) {
      throw new Error("Not implemented: complex permission delta");
    }
    patchableAccess.push(...existingPermissions);
    for (const {
      indexToRemove,
      accessToAdd,
    } of deduplicatedAdditionalPermissions) {
      if (indexToRemove >= 0) {
        patchableAccess[indexToRemove].resourceAccess.concat(
          accessToAdd.resourceAccess,
        );
      } else {
        patchableAccess.push(accessToAdd);
      }
    }
  }

  return patchableAccess;
};

const addToPatchablePermissions = (
  existingAccess: ReadonlyArray<types.ApplicationRequiredResourceAccess>,
  accessToAdd: Array<AppPermissionAddInfo>,
  requiredAccess: types.ApplicationRequiredResourceAccess,
) => {
  const existingForResourceAppIdx = existingAccess.findIndex(
    (r) => r.resourceAppId === requiredAccess.resourceAppId,
  );
  const missingAccess =
    existingForResourceAppIdx < 0
      ? []
      : requiredAccess.resourceAccess.filter(
          (r) =>
            !existingAccess[existingForResourceAppIdx].resourceAccess.some(
              (a) => isDeepStrictEqual(r, a),
            ),
        );
  if (existingForResourceAppIdx < 0 || missingAccess.length > 0) {
    accessToAdd.push({
      indexToRemove: existingForResourceAppIdx,
      accessToAdd:
        existingForResourceAppIdx < 0 ||
        missingAccess.length === requiredAccess.resourceAccess.length
          ? requiredAccess
          : {
              resourceAppId: requiredAccess.resourceAppId,
              resourceAccess:
                requiredAccess.resourceAccess.concat(missingAccess),
            },
    });
  }
};
