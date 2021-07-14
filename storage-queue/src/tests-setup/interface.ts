import * as queue from "@azure/storage-queue";
import * as identity from "@azure/core-auth";
import test, { TestInterface, ExecutionContext } from "ava";

export const thisTest = test as TestInterface<StorageQueueTestContext>;

export interface SingleQueueInfo {
  queueName: string;
  queueURL: string;
}

export interface QueueInfo {
  receiveQueue: SingleQueueInfo;
  poisonQueue: SingleQueueInfo;
  credential:
    | queue.StorageSharedKeyCredential
    | queue.AnonymousCredential
    | identity.TokenCredential;
}
export interface StorageQueueTestContext {
  queueInfo: QueueInfo;
  containerID: string; // ID of Azurite Docker container
}
export const sendMessages = async <T>(
  ctx: ExecutionContext<StorageQueueTestContext>,
  messages: ReadonlyArray<T>,
) => {
  const {
    receiveQueue: { queueURL },
    credential,
  } = ctx.context.queueInfo;
  const queueClient = new queue.QueueClient(queueURL, credential);
  for (const message of messages) {
    await queueClient.sendMessage(JSON.stringify(message));
  }
};
