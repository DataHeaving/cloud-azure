import * as t from "io-ts";
import * as common from "@data-heaving/common";
import * as queue from "@azure/storage-queue";
import * as abi from "../tests-setup/interface";
import { ExecutionContext } from "ava";
import * as spec from "../poll-queue";
import * as events from "../events";

abi.thisTest.serial(
  "Test that message is visible to poll method",
  async (ctx) => {
    const messageObject = "TestMessage";
    let messageID: string | undefined = undefined;
    await performSingleMessageTest(
      ctx,
      {
        validation: t.string,
        messageObject,
      },
      (receivedMessage, receivedMessageID) => {
        messageID = receivedMessageID;
        ctx.deepEqual(receivedMessage, messageObject);
        return Promise.resolve();
      },
      (eventTracker) => ({
        receivedQueueMessages: [
          {
            chronologicalIndex: 0,
            eventArg: eventTracker.receivedQueueMessages[0].eventArg,
          },
        ],
        invalidMessageSeen: [],
        pipelineExecutionComplete: [
          {
            chronologicalIndex: 1,
            eventArg: {
              message: {
                messageText: JSON.stringify(messageObject),
                messageID: messageID!,
              },
              result: { result: "success", value: undefined },
            },
          },
        ],
        deletedFromQueue: [
          {
            chronologicalIndex: 2,
            eventArg: eventTracker.deletedFromQueue[0].eventArg,
          },
        ],
        sentToPoisonQueue: [],
      }),
    );

    ctx.notDeepEqual(messageID, undefined);
  },
);

abi.thisTest.serial(
  "Test that invalid message causes invocation of correct events and no exceptions thrown",
  async (ctx) => {
    let messageID: string | undefined = undefined;
    const messageObject = (123 as unknown) as string;
    const messageText = JSON.stringify(messageObject);
    await performSingleMessageTest(
      ctx,
      {
        validation: t.string,
        messageObject,
      },
      (receivedMessage, receivedMessageID) => {
        messageID = receivedMessageID;
        return Promise.resolve();
      },
      (eventTracker) => ({
        receivedQueueMessages: [
          {
            chronologicalIndex: 0,
            eventArg: eventTracker.receivedQueueMessages[0].eventArg,
          },
        ],
        invalidMessageSeen: [
          {
            chronologicalIndex: 1,
            eventArg: {
              message: {
                messageText,
                messageID: (eventTracker.invalidMessageSeen[0]
                  .eventArg as events.VirtualQueueMessagesProcesingEvents["invalidMessageSeen"])
                  .message.messageID,
              },
              parseError: new SyntaxError(
                "Unexpected token \uFFFD in JSON at position 0",
              ),
            },
          },
        ],
        pipelineExecutionComplete: [],
        deletedFromQueue: [
          {
            chronologicalIndex: 2,
            eventArg: eventTracker.deletedFromQueue[0].eventArg,
          },
        ],
        sentToPoisonQueue: [
          {
            chronologicalIndex: 3,
            eventArg: eventTracker.sentToPoisonQueue[0].eventArg,
          },
        ],
      }),
    );
    ctx.deepEqual(messageID, undefined);
  },
);

const performSingleMessageTest = async <T extends t.Mixed>(
  ctx: ExecutionContext<abi.StorageQueueTestContext>,
  message: {
    validation: T;
    messageObject: t.TypeOf<T>;
  },
  processMessage: spec.PollMessageOptions<T>["processMessage"],
  expectedEventTracker: common.ItemOrFactory<EventTracker, [EventTracker]>,
) => {
  const { eventEmitter, eventTracker } = createEventEmitterAndRecorder();
  await Promise.all([
    sendMessages(ctx, [message.messageObject]),
    waitForMessagesAndThenRun(ctx, async (queueClient, poisonQueueClient) => {
      await spec.pollMessagesOnce(
        spec.getOptionsWithDefaults({
          eventEmitter,
          queueClient,
          messageValidation: message.validation,
          processMessage,
          poisonQueueClient,
        }),
      );
    }),
  ]);

  ctx.deepEqual(
    eventTracker,
    typeof expectedEventTracker === "function"
      ? expectedEventTracker(eventTracker)
      : expectedEventTracker,
  );
};

const sendMessages = async <T>(
  ctx: ExecutionContext<abi.StorageQueueTestContext>,
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

const waitForMessagesAndThenRun = async (
  ctx: ExecutionContext<abi.StorageQueueTestContext>,
  processMessages: (
    queueClient: queue.QueueClient,
    poisonQueueClient: queue.QueueClient,
  ) => Promise<unknown>,
  expectedMessageCount = 1,
) => {
  const {
    receiveQueue: { queueURL },
    poisonQueue: { queueURL: poisonQueueURL },
    credential,
  } = ctx.context.queueInfo;
  const queueClient = new queue.QueueClient(queueURL, credential);
  const poisonQueueClient = new queue.QueueClient(poisonQueueURL, credential);
  while (
    (await queueClient.peekMessages()).peekedMessageItems.length <
    expectedMessageCount
  ) {
    await common.sleep(100);
  }

  await processMessages(queueClient, poisonQueueClient);
};

type EventTracker = Record<
  keyof events.VirtualQueueMessagesProcesingEvents,
  Array<{
    chronologicalIndex: number;
    eventArg: events.VirtualQueueMessagesProcesingEvents[keyof events.VirtualQueueMessagesProcesingEvents];
  }>
>;

const createEventEmitterAndRecorder = () => {
  const eventBuilder = events.createEventEmitterBuilder();
  let chronologicalIndex = 0;
  const eventTracker: EventTracker = {
    receivedQueueMessages: [],
    invalidMessageSeen: [],
    pipelineExecutionComplete: [],
    deletedFromQueue: [],
    sentToPoisonQueue: [],
  };
  for (const evtName of Object.keys(eventTracker)) {
    const eventName = evtName as keyof events.VirtualQueueMessagesProcesingEvents;
    eventBuilder.addEventListener(eventName, (eventArg) => {
      eventTracker[eventName].push({
        chronologicalIndex,
        eventArg,
      });
      ++chronologicalIndex;
    });
  }

  return {
    eventEmitter: eventBuilder.createEventEmitter(),
    eventTracker,
  };
};
