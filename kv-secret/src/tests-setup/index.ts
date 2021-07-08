import * as kv from "@azure/keyvault-secrets";
import * as id from "@azure/core-auth";
import * as http from "@azure/core-http";
import { env } from "process";
import * as common from "@data-heaving/common";
import * as testSupport from "@data-heaving/common-test-support";
import * as abi from "./interface";

abi.thisTest.before("Start ms-vault-mock Container", async (t) => {
  const port = 10000; // Default port for http in ms-vault-mock, see https://github.com/peveuve/ms-vault-mock
  const secretName = "test";
  const secretValue = "test";
  const signCredential: http.ServiceClientCredentials = {
    signRequest: (res) => {
      return Promise.resolve(res);
    },
  };
  const credential = (signCredential as unknown) as id.TokenCredential; // Typings don't expose it, but SecretClient accepts also ServiceClientCredentials
  // If we use this custom credential callback, we would need to simulate full challenge-based flow -> too much hassle for this case.
  // Furthermore, using ServiceClientCredentials I think enables use of http protocol, simplifying running the ms-vault-mock.
  // const credential: id.TokenCredential = {
  //   getToken: () =>
  //     Promise.resolve({
  //       token: "DummyToken",
  //       expiresOnTimestamp: Number.MAX_SAFE_INTEGER,
  //     }),
  // };
  const protocol = "http";
  const {
    containerID,
    containerHostName,
    checkIsReady,
  } = await testSupport.startContainerAsync({
    image: "node:14-alpine3.13",
    containerPorts: [
      {
        containerPort: port,
        checkReadyness: async (host, port) => {
          await new kv.SecretClient(
            `${protocol}://${host}:${port}`,
            credential,
          ).setSecret(secretName, secretValue);
        },
      },
    ],
    containerEnvironment: {},
    networkName: env.MVM_CONTAINER_NW,
    dockerArguments: ["--entrypoint", "sh"],
    imageArguments: [
      "-c",
      // apk update \
      // && apk add openssl \
      // && openssl req -newkey rsa:2048 -x509 -nodes -keyout key.pem -new -out cert.pem -sha256 -days 365 -subj '/C=CO/ST=ST/L=LO/O=OR/OU=OU/CN=CN' \
      // We have to make bubble-gum sed hack in order for the mock to accept empty strings as valid secret values.
      `npm install --global 'ms-vault-mock@0.1.1' \
&& sed -i 's/value: Joi.string()/value: Joi.string().allow("")/' /usr/local/lib/node_modules/ms-vault-mock/lib/routes/models/SecretVersionModel.js \
&& ms-vault-mock`,
    ],
  });
  t.context.containerID = containerID;
  while (!(await checkIsReady())) {
    await common.sleep(1000);
  }

  const kvURL = `${protocol}://${containerHostName}:${port}`;
  const secretVersion = (
    await new kv.SecretClient(kvURL, credential).getSecret(secretName)
  ).properties.version;
  if (!secretVersion) {
    throw new Error(
      `Something went wrong - the version of newly created secret was ${secretVersion}.`,
    );
  }
  t.context.kvInfo = {
    credential,
    kvURL,
    secretName,
    secretValue,
    secretVersion,
  };
});

abi.thisTest.after.always("Shut down ms-vault-mock Container", async (t) => {
  await testSupport.stopContainerAsync(t.context.containerID);
});
