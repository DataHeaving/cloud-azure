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
    await performMessageTest(
      ctx,
      {
        validation: t.string,
        messageObjects: messageObject,
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
        deduplicatedMessages: [],
        pipelineExecutionComplete: [
          {
            chronologicalIndex: 1,
            eventArg: {
              message: {
                messageText: JSON.stringify(messageObject),
                messageID: messageID!, // eslint-disable-line
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
    await performMessageTest(
      ctx,
      {
        validation: t.string,
        messageObjects: messageObject,
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
                messageID:
                  eventTracker.invalidMessageSeen[0].eventArg.message.messageID,
              },
              parseError: new SyntaxError(
                "Unexpected token \uFFFD in JSON at position 0",
              ),
            },
          },
        ],
        deduplicatedMessages: [],
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

abi.thisTest.serial(
  "Test that deleting message within message handler will put message in poison queue",
  async (ctx) => {
    const messageObject = "TestMessage";
    let popReceipt: string | undefined = undefined;
    let messageID: string | undefined = undefined;
    await performMessageTest(
      ctx,
      {
        validation: t.string,
        messageObjects: messageObject,
      },
      async (receivedMessage, receivedMessageID) => {
        await new queue.QueueClient(
          ctx.context.queueInfo.receiveQueue.queueURL,
          ctx.context.queueInfo.credential,
        ).deleteMessage(receivedMessageID, popReceipt!); // eslint-disable-line
      },
      (eventTracker) => {
        const message = {
          messageText: JSON.stringify(messageObject),
          messageID: messageID!, // eslint-disable-line
        };
        return {
          receivedQueueMessages: [
            {
              chronologicalIndex: 0,
              eventArg: eventTracker.receivedQueueMessages[0].eventArg,
            },
          ],
          invalidMessageSeen: [],
          deduplicatedMessages: [],
          pipelineExecutionComplete: [
            {
              chronologicalIndex: 1,
              eventArg: {
                message,
                result: { result: "success", value: undefined },
              },
            },
          ],
          deletedFromQueue: [
            {
              chronologicalIndex: 2,
              eventArg: {
                message,
                result: {
                  result: "error",
                  errors: (eventTracker.deletedFromQueue[0].eventArg as any).result.errors, // eslint-disable-line
                },
              },
            },
          ],
          sentToPoisonQueue: [
            {
              chronologicalIndex: 3,
              eventArg: eventTracker.sentToPoisonQueue[0].eventArg,
            },
          ],
        };
      },
      {
        receivedQueueMessages: (arg) => {
          if (arg.result === "success") {
            popReceipt = arg.value.receivedMessageItems[0].popReceipt;
            messageID = arg.value.receivedMessageItems[0].messageId;
          }
        },
      },
    );
  },
);

abi.thisTest.serial(
  "Test that correct events are sent and nothing gets stuck when no messages pending in queue",
  async (ctx) => {
    const { eventEmitter, eventTracker } = createEventEmitterAndRecorder();
    let processMessageCalled = false;
    await waitForMessagesAndThenRun(
      ctx,
      async (queueClient, poisonQueueClient) => {
        await spec.pollMessagesOnce(
          spec.getOptionsWithDefaults({
            eventEmitter,
            queueClient,
            messageValidation: t.undefined,
            processMessage: () => {
              processMessageCalled = true;
              return Promise.resolve();
            },
            poisonQueueClient,
          }),
        );
      },
      0,
    );
    ctx.false(processMessageCalled);
    ctx.deepEqual(
      eventTracker.receivedQueueMessages[0].eventArg.result,
      "success",
    );
    ctx.deepEqual(eventTracker, {
      receivedQueueMessages: [
        {
          chronologicalIndex: 0,
          eventArg: eventTracker.receivedQueueMessages[0].eventArg,
        },
      ],
      invalidMessageSeen: [],
      deduplicatedMessages: [],
      pipelineExecutionComplete: [],
      deletedFromQueue: [],
      sentToPoisonQueue: [],
    });
  },
);

abi.thisTest.serial(
  "Test that passing wrong URL will result with correct events",
  async (ctx) => {
    const { eventEmitter, eventTracker } = createEventEmitterAndRecorder();
    let processMessageCalled = false;
    await waitForMessagesAndThenRun(
      ctx,
      async (queueClient, poisonQueueClient) => {
        await spec.pollMessagesOnce(
          spec.getOptionsWithDefaults({
            eventEmitter,
            queueClient: new queue.QueueClient(
              `${queueClient.url}-not-existing`,
              ctx.context.queueInfo.credential,
            ),
            messageValidation: t.undefined,
            processMessage: () => {
              processMessageCalled = true;
              return Promise.resolve();
            },
            poisonQueueClient,
          }),
        );
      },
      0,
    );
    ctx.false(processMessageCalled);
    ctx.deepEqual(
      eventTracker.receivedQueueMessages[0].eventArg.result,
      "error",
    );
    ctx.deepEqual(eventTracker, {
      receivedQueueMessages: [
        {
          chronologicalIndex: 0,
          eventArg: eventTracker.receivedQueueMessages[0].eventArg,
        },
      ],
      invalidMessageSeen: [],
      deduplicatedMessages: [],
      pipelineExecutionComplete: [],
      deletedFromQueue: [],
      sentToPoisonQueue: [],
    });
  },
);

abi.thisTest.serial(
  "Test that deduplication works as expected",
  async (ctx) => {
    const messageObjects = [
      { key: "key", payload: "Message1" },
      { key: "key", payload: "Message2" },
    ];
    let messageID: string | undefined = undefined;
    await performMessageTest(
      ctx,
      {
        validation: t.type({ key: t.string, payload: t.string }),
        messageObjects,
      },
      (receivedMessage, receivedMessageID) => {
        messageID = receivedMessageID;
        ctx.deepEqual(receivedMessage, messageObjects[0]);
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
        deduplicatedMessages: [
          {
            chronologicalIndex: 1,
            eventArg: {
              messageKey: messageObjects[0].key,
              messages: messageObjects.map((msg, idx) => ({
                messageID: (eventTracker.receivedQueueMessages[0].eventArg as {
                  value: queue.QueueReceiveMessageResponse;
                }).value.receivedMessageItems[idx].messageId,
                messageText: JSON.stringify(msg),
              })),
            },
          },
        ],
        pipelineExecutionComplete: [
          {
            chronologicalIndex: 2,
            eventArg: {
              message: {
                messageText: JSON.stringify(messageObjects[0]),
              messageID: messageID!, // eslint-disable-line
              },
              result: { result: "success", value: undefined },
            },
          },
        ],
        deletedFromQueue: [
          {
            chronologicalIndex: 3,
            eventArg: eventTracker.deletedFromQueue[0].eventArg,
          },
          {
            chronologicalIndex: 4,
            eventArg: eventTracker.deletedFromQueue[1].eventArg,
          },
        ],
        sentToPoisonQueue: [],
      }),
      {},
      (item) => item.key,
    );

    ctx.notDeepEqual(messageID, undefined);
  },
);

abi.thisTest.serial(
  "Test that throwing exception in message processor is catched and retried",
  async (ctx) => {
    const errors: Array<Error> = [];
    const messageObject = "TestMessage";
    let messageID: string | undefined = undefined;
    await performMessageTest(
      ctx,
      {
        validation: t.string,
        messageObjects: messageObject,
      },
      (receivedMessage, receivedMessageID) => {
        messageID = receivedMessageID;
        errors.push(new Error("This should not leak"));
        throw errors[errors.length - 1];
      },
      (eventTracker) => {
        const message = {
          messageText: JSON.stringify(messageObject),
          messageID: messageID!, // eslint-disable-line
        };
        return {
          receivedQueueMessages: [
            {
              chronologicalIndex: 0,
              eventArg: eventTracker.receivedQueueMessages[0].eventArg,
            },
          ],
          invalidMessageSeen: [],
          deduplicatedMessages: [],
          pipelineExecutionComplete: [
            {
              chronologicalIndex: 1,
              eventArg: {
                message,
                result: { result: "error", errors },
              },
            },
          ],
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
        };
      },
    );
    ctx.deepEqual(errors.length, spec.OPTION_DEFAULTS.processMessageRetry + 1);
  },
);

const performMessageTest = async <T extends t.Mixed>(
  ctx: ExecutionContext<abi.StorageQueueTestContext>,
  message: {
    validation: T;
    messageObjects: OneOrMany<t.TypeOf<T>>;
  },
  processMessage: spec.PollMessageOptions<T>["processMessage"],
  expectedEventTracker: common.ItemOrFactory<EventTracker, [EventTracker]>,
  customEventHandlers: CustomEventHandlers = {},
  deduplicateMessagesBy?: spec.PollMessageOptions<T>["deduplicateMessagesBy"],
) => {
  const { eventEmitter, eventTracker } = createEventEmitterAndRecorder(
    customEventHandlers,
  );
  const { messageObjects, validation } = message;
  const messageObjectsArray = Array.isArray(messageObjects)
    ? messageObjects
    : [messageObjects];
  await Promise.all([
    abi.sendMessages(ctx, messageObjectsArray),
    waitForMessagesAndThenRun(
      ctx,
      async (queueClient, poisonQueueClient) => {
        await spec.pollMessagesOnce(
          spec.getOptionsWithDefaults({
            eventEmitter,
            queueClient,
            messageValidation: validation,
            processMessage,
            poisonQueueClient,
            deduplicateMessagesBy,
          }),
        );
      },
      messageObjectsArray.length,
    ),
  ]);

  ctx.deepEqual(
    eventTracker,
    typeof expectedEventTracker === "function"
      ? expectedEventTracker(eventTracker)
      : expectedEventTracker,
  );
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
    (
      await queueClient.peekMessages({
        numberOfMessages: Math.max(expectedMessageCount, 1),
      })
    ).peekedMessageItems.length < expectedMessageCount
  ) {
    await common.sleep(100);
  }

  await processMessages(queueClient, poisonQueueClient);
};

type EventTracker = {
  [E in keyof events.VirtualQueueMessagesProcesingEvents]: Array<{
    chronologicalIndex: number;
    eventArg: events.VirtualQueueMessagesProcesingEvents[E];
  }>;
};

type CustomEventHandlers = Partial<
  {
    [E in keyof events.VirtualQueueMessagesProcesingEvents]: common.EventHandler<
      events.VirtualQueueMessagesProcesingEvents[E]
    >;
  }
>;

const createEventEmitterAndRecorder = (
  customEventHandlers: CustomEventHandlers = {},
) => {
  const eventBuilder = events.createEventEmitterBuilder();
  let chronologicalIndex = 0;
  const eventTracker: EventTracker = {
    receivedQueueMessages: [],
    invalidMessageSeen: [],
    deduplicatedMessages: [],
    pipelineExecutionComplete: [],
    deletedFromQueue: [],
    sentToPoisonQueue: [],
  };
  for (const evtName of Object.keys(eventTracker)) {
    const eventName = evtName as keyof events.VirtualQueueMessagesProcesingEvents;
    eventBuilder.addEventListener(eventName, (eventArg) => {
      eventTracker[eventName].push({
        chronologicalIndex,
        eventArg: eventArg as any, // eslint-disable-line
      });
      ++chronologicalIndex;
    });
    const handler = customEventHandlers[eventName];
    if (handler) {
      eventBuilder.addEventListener(
        eventName,
        handler as common.EventHandler<
          events.VirtualQueueMessagesProcesingEvents[typeof eventName]
        >,
      );
    }
  }

  return {
    eventEmitter: eventBuilder.createEventEmitter(),
    eventTracker,
  };
};

// TODO move this to common
type OneOrMany<T> = T | Array<T>;
