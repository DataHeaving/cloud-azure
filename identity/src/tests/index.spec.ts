import * as id from "@azure/identity";
import test, { ExecutionContext } from "ava";
import * as spec from "..";

test("Env variables are picked up", (t) => {
  // Call getEnvOrManagedIDAuth without args: This will check whether NODE_ENV env var has been set to DEV (see package.json, ava -> environmentalVariables)
  isEnvID(t);

  // This will check whether ANOTHER_VAR env var has been set to DEV (see package.json, ava -> environmentalVariables)
  isEnvID(t, { envVarOptions: { varName: "ANOTHER_VAR" } });

  // This will check whether YET_ANOTHER_VAR env var has been set to SOME_VAL (see package.json, ava -> environmentalVariables)
  isEnvID(t, {
    envVarOptions: { varName: "YET_ANOTHER_VAR", varValue: "SOME_VAL" },
  });

  // This will do the same tests but overriding env dictionary
  isEnvID(t, {
    envVarOptions: {
      overrideEnv: { NODE_ENV: "DEV" },
    },
  });

  isEnvID(t, {
    envVarOptions: {
      overrideEnv: { _ANOTHER_VAR: "DEV" },
      varName: "_ANOTHER_VAR",
    },
  });

  isEnvID(t, {
    envVarOptions: {
      overrideEnv: { _YET_ANOTHER_VAR: "SOME_VAL" },
      varName: "_YET_ANOTHER_VAR",
      varValue: "SOME_VAL",
    },
  });
});

test("Managed ID is picked up", (t) => {
  // Since env variables are already set by AVA, we must specify these explicit env var options which should force usage of managed ID
  // Typically passing these is not required.
  const envVarOptions: spec.AzureAuthOptions["envVarOptions"] = {
    overrideEnv: {},
    varName: "SHOULD_NOT_EXIST_IN_PROCESS_ENV",
  };
  isManagedID(t, undefined, {
    envVarOptions,
  });

  const clientID = "client-ID";
  isManagedID(t, clientID, { envVarOptions, managedIdentityID: clientID });
});

const isEnvID = (
  t: ExecutionContext,
  ...args: Parameters<typeof spec.getEnvOrManagedIDAuth>
) => isSomeID(t, id.EnvironmentCredential, ...args);

const isManagedID = (
  t: ExecutionContext,
  clientID: string | undefined,
  ...args: Parameters<typeof spec.getEnvOrManagedIDAuth>
) => {
  const auth = isSomeID(t, id.ManagedIdentityCredential, ...args);
  t.deepEqual(
    ((auth as unknown) as Record<string, unknown>)["clientId"],
    clientID,
  );
};

const isSomeID = (
  t: ExecutionContext,
  clazz: new (...args: any[]) => any, // eslint-disable-line @typescript-eslint/no-explicit-any
  ...args: Parameters<typeof spec.getEnvOrManagedIDAuth>
) => {
  const auth = spec.getEnvOrManagedIDAuth(...args);
  t.true(auth instanceof clazz);
  return auth;
};
