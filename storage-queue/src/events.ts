import * as queue from "@azure/storage-queue";
import * as common from "@data-heaving/common";

export interface MessageInfo {
  messageText: string;
  messageID: string;
}
export interface VirtualQueueMessagesProcesingEvents {
  receivedQueueMessages: common.RetryExecutionResult<queue.QueueReceiveMessageResponse>;
  invalidMessageSeen: {
    message: MessageInfo;
    parseError: unknown;
  };
  deduplicatedMessages: {
    messageKey: string;
    messages: ReadonlyArray<MessageInfo>;
  };
  pipelineExecutionComplete: {
    message: MessageInfo;
    result: common.RetryExecutionResult<unknown>;
  };
  deletedFromQueue: {
    message: MessageInfo;
    result: common.RetryExecutionResult<queue.MessageIdDeleteResponse>;
  };
  sentToPoisonQueue: {
    message: MessageInfo;
    result: common.RetryExecutionResult<queue.QueueSendMessageResponse>;
  };
}

export type EventEmitter = common.EventEmitter<VirtualQueueMessagesProcesingEvents>;

export const createEventEmitterBuilder = () =>
  new common.EventEmitterBuilder<VirtualQueueMessagesProcesingEvents>();

export const consoleLoggingEventEmitterBuilder = (
  logMessageText: boolean,
  logMessagePrefix?: Parameters<typeof common.createConsoleLogger>[0],
  builder?: common.EventEmitterBuilder<VirtualQueueMessagesProcesingEvents>,
  consoleAbstraction?: common.ConsoleAbstraction,
) => {
  if (!builder) {
    builder = new common.EventEmitterBuilder<VirtualQueueMessagesProcesingEvents>();
  }
  const logger = common.createConsoleLogger(
    logMessagePrefix,
    consoleAbstraction,
  );
  builder.addEventListener("receivedQueueMessages", (arg) =>
    logRetryResult(
      logger,
      arg,
      (receivedMessages) =>
        `Received ${
          receivedMessages.receivedMessageItems.length
        } messages with IDs ${receivedMessages.receivedMessageItems
          .map(({ messageId }) => messageId)
          .join(", ")} from queue.`,
      (errors) =>
        `Errors while trying to receive messages: ${errors.join("\n")}.`,
    ),
  );
  builder.addEventListener("invalidMessageSeen", ({ message, parseError }) =>
    logger(
      `Error in parsing message with ID ${message.messageID}${
        logMessageText ? ` and text "${message.messageText}"` : ""
      }:\n${parseError}`,
      true,
    ),
  );
  builder.addEventListener("deduplicatedMessages", (arg) =>
    logger(
      `Deduplicated ${arg.messages.length} messages into one${
        logMessageText ? ` with key ${arg.messageKey}` : ""
      }`,
    ),
  );
  builder.addEventListener("pipelineExecutionComplete", ({ message, result }) =>
    logRetryResult(
      logger,
      result,
      () =>
        `Successfully processed message with ID ${message.messageID}${
          logMessageText ? ` and text "${message.messageText}"` : ""
        }`,
      (errors) =>
        `Errors while processing message with ID ${message.messageID}${
          logMessageText ? ` and text "${message.messageText}"` : ""
        }: ${errors.join("\n")}.`,
    ),
  );
  builder.addEventListener("deletedFromQueue", (arg) =>
    logRetryResult(
      logger,
      arg.result,
      () =>
        `Deleted message ${arg.message.messageID}${
          logMessageText ? ` with text "${arg.message.messageText}"` : ""
        } from queue`,
      (errors) =>
        `Errors while trying to delete message ${arg.message.messageID}${
          logMessageText ? ` with text "${arg.message.messageText}"` : ""
        } from queue: ${errors.join("\n")}`,
    ),
  );
  builder.addEventListener("sentToPoisonQueue", (arg) =>
    logRetryResult(
      logger,
      arg.result,
      (poisonedMessage) =>
        `Poison queue message for received message ${arg.message.messageID}${
          logMessageText ? ` with text "${arg.message.messageText}"` : ""
        } sent: ${poisonedMessage.messageId}`,
      (errors) =>
        `Errors when adding message ${arg.message.messageID}${
          logMessageText ? ` with text "${arg.message.messageText}"` : ""
        } to poison queue: ${errors.join("\n")}`,
      true, // All poison queue events are always considered as error
    ),
  );

  return builder;
};

// TODO move to @data-heaving/common package...
const logRetryResult = <T>(
  logger: ReturnType<typeof common.createConsoleLogger>,
  result: common.RetryExecutionResult<T>,
  whenSuccess: (value: T) => string,
  whenError: (errors: ReadonlyArray<unknown>) => string,
  overrideError?: boolean,
) =>
  logger(
    result.result === "success"
      ? whenSuccess(result.value)
      : whenError(result.errors),
    overrideError ?? result.result === "error",
  );
