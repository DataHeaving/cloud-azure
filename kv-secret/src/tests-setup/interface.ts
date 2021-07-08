import * as identity from "@azure/core-auth";
import test, { TestInterface } from "ava";

export const thisTest = test as TestInterface<KeyVaultSecretTestContext>;

export interface KeyVaultSecretInfo {
  kvURL: string;
  secretName: string;
  secretVersion: string;
  secretValue: string;
  credential: identity.TokenCredential;
}
export interface KeyVaultSecretTestContext {
  kvInfo: KeyVaultSecretInfo;
  containerID: string;
}
