import * as queue from "@azure/storage-queue";
import * as identity from "@azure/core-auth";
import test, { TestInterface } from "ava";

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
