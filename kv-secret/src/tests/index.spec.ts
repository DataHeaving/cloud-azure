import * as kv from "@azure/keyvault-secrets";
import * as http from "@azure/core-http";
import { ExecutionContext } from "ava";
import { URL } from "url";
import * as spec from "..";
import * as abi from "../tests-setup/interface";

abi.thisTest(
  "Test that secret getting works without secret version",
  async (t) => {
    await performTestForExistingSecretForAllMethods(t, false);
  },
);

abi.thisTest(
  "Test that secret getting works with secret version",
  async (t) => {
    await performTestForExistingSecretForAllMethods(t, true);
  },
);

abi.thisTest(
  "Test that getting non-existant secret always results in error",
  async (t) => {
    await Promise.all([
      performTestForNonExistingSecretForAllMethods(t, false),
      performTestForNonExistingSecretForAllMethods(t, true),
    ]);
  },
);

abi.thisTest(
  "Test that empty secret causes SecretDoesNotExistError",
  async (t) => {
    const { credential, kvURL, secretName } = t.context.kvInfo;
    const newSecret = `new-${secretName}`;
    await new kv.SecretClient(kvURL, credential).setSecret(newSecret, "");
    await t.throwsAsync(
      spec.getMandatorySecretValue(credential, {
        kvURL,
        secretName: newSecret,
      }),
      {
        instanceOf: spec.SecretDoesNotExistError,
      },
    );
  },
);

abi.thisTest("Test that malformed URL throws correct error", async (t) => {
  const { credential, kvURL, secretName } = t.context.kvInfo;
  await t.throwsAsync(spec.getSecret(credential, `${kvURL}/${secretName}`), {
    instanceOf: spec.MalformedSecretURLError,
  });
});

abi.thisTest(
  "Test that errors not related to secret not existing are passed through as-is",
  async (t) => {
    const { credential, kvURL, secretName } = t.context.kvInfo;
    await t.throwsAsync(
      spec.getSecret(credential, {
        kvURL: `${kvURL}/dummy/dummy2`,
        secretName,
      }),
      {
        instanceOf: http.RestError,
      },
    );
  },
);

const performTestForExistingSecretForAllMethods = async (
  t: ExecutionContext<abi.KeyVaultSecretTestContext>,
  useVersion: boolean,
) => {
  await Promise.all([
    performTestForSecret(
      t,
      spec.getMandatorySecretValue,
      (str) => str,
      useVersion,
    ),
    performTestForSecret(t, spec.getSecretValue, (str) => str, useVersion),
    performTestForSecret(
      t,
      spec.getSecret,
      (secret) => secret.secret.value,
      useVersion,
    ),
  ]);
};

const performTestForNonExistingSecretForAllMethods = async (
  t: ExecutionContext<abi.KeyVaultSecretTestContext>,
  useVersion: boolean,
) => {
  const secretName = `${t.context.kvInfo.secretName}-not`;
  await Promise.all([
    t.throwsAsync(
      performTestForSecret(
        t,
        spec.getMandatorySecretValue,
        (str) => str,
        useVersion,
        secretName,
      ),
      {
        instanceOf: spec.SecretDoesNotExistError,
      },
    ),
    t.throwsAsync(
      performTestForSecret(
        t,
        spec.getSecretValue,
        (str) => str,
        useVersion,
        secretName,
      ),
      {
        instanceOf: spec.SecretDoesNotExistError,
      },
    ),
    t.throwsAsync(
      performTestForSecret(
        t,
        spec.getSecret,
        (secret) => secret.secret.value,
        useVersion,
        secretName,
      ),
      {
        instanceOf: spec.SecretDoesNotExistError,
      },
    ),
  ]);
};

const performTestForSecret = async <T>(
  t: ExecutionContext<abi.KeyVaultSecretTestContext>,
  method: (...params: Parameters<typeof spec.getSecret>) => Promise<T>,
  getSecretValue: (result: T) => string | undefined,
  useVersion: boolean,
  secretNameToUse?: string,
) => {
  const { kvURL, secretName, secretVersion, performTest } = prepareTest(
    t,
    method,
    getSecretValue,
  );
  if (!secretNameToUse) {
    secretNameToUse = secretName;
  }
  await performTest({
    kvURL,
    secretName: secretNameToUse,
    secretVersion: useVersion ? secretVersion : undefined,
  });
  const secretURL = `${kvURL}/secrets/${secretNameToUse}${
    useVersion ? `/${secretVersion}` : ""
  }`;
  await performTest(secretURL);
  await performTest(new URL(secretURL));
};

const prepareTest = <T>(
  t: ExecutionContext<abi.KeyVaultSecretTestContext>,
  method: (...params: Parameters<typeof spec.getSecret>) => Promise<T>,
  getSecretValue: (result: T) => string | undefined,
) => {
  const {
    credential,
    kvURL,
    secretName,
    secretVersion,
    secretValue,
  } = t.context.kvInfo;
  return {
    kvURL,
    secretName,
    secretVersion,
    performTest: async (kvRefOrURL: Parameters<typeof spec.getSecret>[1]) => {
      const result = await method(credential, kvRefOrURL);
      t.deepEqual(getSecretValue(result), secretValue);
    },
  };
};
