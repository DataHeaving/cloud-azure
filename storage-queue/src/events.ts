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
  pipelineExecutionComplete: {
    message: MessageInfo;
    result: common.RetryExecutionResult<unknown>;
  };
  deletedFromQueue: common.RetryExecutionResult<queue.MessageIdDeleteResponse>;
  sentToPoisonQueue: common.RetryExecutionResult<queue.QueueSendMessageResponse>;
}

export type EventEmitter = common.EventEmitter<VirtualQueueMessagesProcesingEvents>;

export const createEventEmitterBuilder = () =>
  new common.EventEmitterBuilder<VirtualQueueMessagesProcesingEvents>();

export const createConsoleLoggingEventEmitterBuilder = (
  logMessageText: boolean,
  logMessagePrefix?: string,
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
        `Received ${receivedMessages.receivedMessageItems.length} messages from queue.`,
      (errors) =>
        `Errors while trying to receive messages: ${errors.join("\n")}.`,
    ),
  );
  builder.addEventListener("invalidMessageSeen", ({ message, parseError }) =>
    logger(
      `Error in parsing message${
        logMessageText ? ` ${message.messageText}` : ""
      }:\n${parseError}`,
      true,
    ),
  );
  builder.addEventListener("pipelineExecutionComplete", ({ message, result }) =>
    logRetryResult(
      logger,
      result,
      () =>
        `Successfully processed message${
          logMessageText ? ` ${message.messageText}` : ""
        }`,
      (errors) =>
        `Errors while processing message ${
          logMessageText ? ` ${message.messageText}` : ""
        }: ${errors.join("\n")}.`,
      true,
    ),
  );
  builder.addEventListener("deletedFromQueue", (arg) =>
    logRetryResult(
      logger,
      arg,
      (deletedMessage) =>
        `Deleted message ${deletedMessage.requestId} from queue`,
      (errors) =>
        `Errors while trying to delete messages from queue: ${errors.join(
          "\n",
        )}`,
    ),
  );
  builder.addEventListener("sentToPoisonQueue", (arg) =>
    logRetryResult(
      logger,
      arg,
      (poisonedMessage) =>
        `Sent poison queue message ${poisonedMessage.messageId}`,
      (errors) =>
        `Errors while trying to delete messages from poison queue: ${errors.join(
          "\n",
        )}`,
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
