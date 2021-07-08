import * as queue from "@azure/storage-queue";
import * as common from "@data-heaving/common";

export type VirtualQueueMessagesProcesingEvents = {
  receivedQueueMessages: common.RetryExecutionResult<queue.QueueReceiveMessageResponse>;
  invalidMessageSeen: {
    messageText: string;
    parseError: unknown;
  };
  pipelineExecutionError: {
    messageText: string;
    error: unknown;
  };
  deletedFromQueue: common.RetryExecutionResult<queue.MessageIdDeleteResponse>;
  sentToPoisonQueue: common.RetryExecutionResult<queue.QueueSendMessageResponse>;
};

export type EventEmitter = common.EventEmitter<VirtualQueueMessagesProcesingEvents>;

export const createQueuePollingEventEmitterBuilder = (
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
  builder.addEventListener("invalidMessageSeen", (arg) =>
    logger(
      `Error in parsing message${
        logMessageText ? ` ${arg.messageText}` : ""
      }:\n${arg.parseError}`,
      true,
    ),
  );
  builder.addEventListener("pipelineExecutionError", (arg) =>
    logger(
      `Processing message${
        logMessageText ? ` ${arg.messageText}` : ""
      } resulted in error: ${arg.error}`,
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
