import process from "process";
import * as id from "@azure/identity";

export type AzureAuthOptions = Partial<{
  envVarOptions: {
    varName?: string;
    varValue?: string;
    overrideEnv?: Record<string, string>;
  };
  managedIdentityID: string;
}>;

export const getEnvOrManagedIDAuth = (opts?: AzureAuthOptions) =>
  (opts?.envVarOptions?.overrideEnv ?? process.env)[
    opts?.envVarOptions?.varName ?? "NODE_ENV"
  ] === (opts?.envVarOptions?.varValue ?? "DEV")
    ? new id.EnvironmentCredential()
    : opts?.managedIdentityID
    ? new id.ManagedIdentityCredential(opts.managedIdentityID)
    : new id.ManagedIdentityCredential();
