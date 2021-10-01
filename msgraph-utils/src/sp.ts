import "cross-fetch";
import "cross-fetch/polyfill";
import * as graph from "@microsoft/microsoft-graph-client";
import * as validation from "@data-heaving/common-validation";
import * as common from "@data-heaving/common";
import * as types from "./types";
import * as utils from "./utils";
import * as applications from "./app";

export const spGraphApi = "/servicePrincipals";
export const getOrCreateServicePrincipalForApplication = async (
  client: graph.Client,
  applicationOrId: string | types.Application,
) => {
  const existingSP = await tryGetServicePrincipalByAppId(
    client,
    applicationOrId,
  );
  const servicePrincipal =
    existingSP ??
    validation.decodeOrThrow(
      types.servicePrincipal.decode,
      await client.api(spGraphApi).post({
        appId: applicationOrId,
      }),
    );
  return servicePrincipal;
};

export const tryGetServicePrincipalByAppId = async (
  client: graph.Client,
  applicationOrId: string | types.Application,
): Promise<types.ServicePrincipal | undefined> =>
  validation.decodeOrThrow(
    utils.graphAPIListOf(types.servicePrincipal).decode,
    await client
      .api(spGraphApi)
      .filter(
        `appId eq '${
          typeof applicationOrId === "string"
            ? applicationOrId
            : applicationOrId.appId
        }'`,
      )
      .get(),
  ).value[0];

export const tryGetServicePrincipalByID = async (
  client: graph.Client,
  servicePrincipalId: string,
): Promise<types.ServicePrincipal | undefined> => {
  try {
    return validation.decodeOrThrow(
      types.servicePrincipal.decode,
      await client.api(`${spGraphApi}/${servicePrincipalId}`).get(),
    );
  } catch (e) {
    if (!(e instanceof graph.GraphError && e.statusCode === 404)) {
      throw e;
    }
  }
};

export const ensureServicePrincipalRoleAssignments = async (
  client: graph.Client,
  target:
    | string
    | { app: string | types.Application; sp: string | types.ServicePrincipal },
) => {
  const app =
    (typeof target === "string"
      ? await applications.tryGetApplicationByDisplayName(client, target)
      : typeof target.app === "string"
      ? await applications.tryGetApplicationByID(client, target.app)
      : target.app) ??
    utils.doThrow<types.Application>("Could not find application.");
  const sp =
    (typeof target === "string"
      ? await tryGetServicePrincipalByAppId(client, app.appId)
      : typeof target.sp === "string"
      ? await tryGetServicePrincipalByID(client, target.sp)
      : target.sp) ??
    utils.doThrow<types.ServicePrincipal>("Could not find service principal.");

  // We need to find out which permission we need to grant admin consent for
  const spRoleAssignmentsApi = `${spGraphApi}/${sp.id}/appRoleAssignments`;
  const adminConsentedRoleAssignments = validation.decodeOrThrow(
    utils.graphAPIListOf(types.servicePrincipalAppRoleAssignment).decode,
    await client.api(spRoleAssignmentsApi).get(),
  ).value;

  // Get target SPs
  const consentedResourceSPs = await getResourceSPMap(
    client,
    common.deduplicate(
      adminConsentedRoleAssignments.map(({ resourceId }) => ({
        id: resourceId,
        isSPId: true,
      })),
      ({ id }) => id,
    ),
  );

  const adminConsentedRoleAssignmentsMap = adminConsentedRoleAssignments.reduce<
    Record<string, Record<string, types.ServicePrincipalAppRoleAssignment>>
  >((curMap, roleAssignment) => {
    common.getOrAddGeneric(curMap, roleAssignment.resourceId, () => ({}))[
      roleAssignment.appRoleId
    ] = roleAssignment;
    return curMap;
  }, {});

  const adminConsentNeededOn = app.requiredResourceAccess
    .flatMap(({ resourceAppId, resourceAccess }) => {
      const resourceSP = consentedResourceSPs[resourceAppId];
      const missingResources = resourceSP
        ? resourceAccess.filter(
            (access) =>
              !adminConsentedRoleAssignmentsMap[resourceSP.id]?.[access.id],
          )
        : resourceAccess;
      return missingResources.length > 0
        ? { resourceAppId, resourceAccess: missingResources }
        : undefined;
    })
    .filter(
      (
        roleAssignment,
      ): roleAssignment is types.ApplicationRequiredResourceAccess =>
        !!roleAssignment,
    );

  if (adminConsentNeededOn.length > 0) {
    const consentResourceSPs = await getResourceSPMap(
      client,
      adminConsentNeededOn.map(({ resourceAppId }) => ({
        id: resourceAppId,
        isSPId: false,
      })),
    );

    (
      await Promise.all(
        adminConsentNeededOn.flatMap(({ resourceAppId, resourceAccess }) => {
          return resourceAccess.map((resource) => {
            return client.api(spRoleAssignmentsApi).post({
              principalId: sp.id,
              resourceId: consentResourceSPs[resourceAppId].id,
              appRoleId: resource.id,
            });
          });
        }),
      )
    ).map((response) =>
      validation.decodeOrThrow(
        types.servicePrincipalAppRoleAssignment.decode,
        response,
      ),
    );
  }

  return adminConsentNeededOn;
};

const getResourceSPMap = async (
  client: graph.Client,
  ids: ReadonlyArray<{ id: string; isSPId: boolean }>,
) =>
  (
    await Promise.all(
      ids.map(async ({ id, isSPId }) =>
        isSPId
          ? await tryGetServicePrincipalByID(client, id)
          : await tryGetServicePrincipalByAppId(client, id),
      ),
    )
  ).reduce<Record<string, types.ServicePrincipal>>((curMap, sp, idx) => {
    if (!sp) {
      throw new Error(
        `Could not find service principal: ${JSON.stringify(ids[idx])}.`,
      );
    }
    curMap[sp.appId] = sp; // In case of AAD, the appID will be the "00000002-0000-0000-c000-000000000000", which also is resourceAppId of types.ApplicationRequiredResourceAccess
    return curMap;
  }, {});
