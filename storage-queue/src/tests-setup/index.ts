import * as queue from "@azure/storage-queue";
import { env } from "process";
import * as common from "@data-heaving/common";
import * as testSupport from "@data-heaving/common-test-support";
import * as abi from "./interface";

abi.thisTest.before("Start Azurite Container", async (t) => {
  const storageAccountName = "devstoreaccount1";
  const credential = new queue.StorageSharedKeyCredential(
    "devstoreaccount1",
    "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==",
  ); // See https://github.com/Azure/Azurite for default credentials
  const queueName = "test-queue";
  const defaultQueuePort = 10001; // Queue endpoint is running in port 10001, unlike storage endpoint running at 10000
  const port = env.AZURE_STORAGE_QUEUE_DOCKER_NW ? defaultQueuePort : 30201; // When running in GitHub pipeline, for some reason port 10001 is already taken
  const {
    containerID,
    containerHostName,
    checkIsReady,
  } = await testSupport.startContainerAsync({
    image: "mcr.microsoft.com/azure-storage/azurite:3.13.1",
    containerPorts: [
      {
        containerPort: defaultQueuePort, // Queue endpoint is running in port 10001, unlike storage endpoint running at 10000
        exposedPort: port,
        checkReadyness: async (host, port) => {
          await new queue.QueueClient(
            `http://${host}:${port}/${storageAccountName}/${queueName}`,
            credential,
          ).create();
        },
      },
    ],
    containerEnvironment: {},
    networkName: env.AZURE_STORAGE_QUEUE_DOCKER_NW,
  });
  t.context.containerID = containerID;
  const saURL = `http://${containerHostName}:${port}/${storageAccountName}`;
  const queueURL = `${saURL}/${queueName}`;

  const poisonQueueName = `${queueName}-poison`;
  const poisonQueueURL = `${saURL}/${poisonQueueName}`;
  await new queue.QueueClient(poisonQueueURL, credential).create();

  t.context.queueInfo = {
    receiveQueue: {
      queueName,
      queueURL,
    },
    poisonQueue: {
      queueName: poisonQueueName,
      queueURL: poisonQueueURL,
    },
    credential,
  };

  while (!(await checkIsReady())) {
    await common.sleep(1000);
  }
});

// abi.thisTest.beforeEach("Create queue message", async (t) => {
//   const { queueURL, credential } = t.context.queueInfo;
//   await new queue.QueueClient(queueURL, credential).sendMessage();
// });

// abi.thisTest.afterEach.always("Delete queue message", async (t) => {
//   const { queueURL, credential } = t.context.queueInfo;
//   await new queue.QueueClient(queueURL, credential).deleteMessage();
// });

abi.thisTest.after.always("Shut down Azurite Container", async (t) => {
  await testSupport.stopContainerAsync(t.context.containerID);
});
