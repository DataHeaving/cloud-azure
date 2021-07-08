import * as queue from "@azure/storage-queue";
import * as t from "io-ts";
import * as common from "@data-heaving/common";
import * as validation from "@data-heaving/common-validation";
import * as events from "./events";

export interface PollMessageOptions<TValidation extends t.Mixed> {
  eventEmitter: events.EventEmitter;
  queueClient: queue.QueueClient;
  messageValidation: TValidation;
  processMessage: (message: t.TypeOf<TValidation>) => Promise<unknown>;
  receiveMessageVisibilityTimeout: number;
  receiveMessageRetry: number;
  processMessageRetry: number;
  deleteMessageRetry: number;
  poisonQueueAddMessageRetry: number;
}

export const OPTION_DEFAULTS: Pick<
  PollMessageOptions<t.UnknownC>,
  | "receiveMessageVisibilityTimeout"
  | "receiveMessageRetry"
  | "processMessageRetry"
  | "deleteMessageRetry"
  | "poisonQueueAddMessageRetry"
> = {
  receiveMessageVisibilityTimeout: 60, // 1hour timeout
  receiveMessageRetry: 5,
  processMessageRetry: 5,
  deleteMessageRetry: 5,
  poisonQueueAddMessageRetry: 5,
};

export const getOptionsWithDefaults = <TValidation extends t.Mixed>(
  opts: Pick<
    PollMessageOptions<TValidation>,
    Exclude<keyof PollMessageOptions<TValidation>, keyof typeof OPTION_DEFAULTS>
  > &
    Partial<typeof OPTION_DEFAULTS>,
): PollMessageOptions<TValidation> => {
  return {
    ...OPTION_DEFAULTS,
    ...opts,
  };
};

export const pollMessagesOnce = async <TValidation extends t.Mixed>({
  eventEmitter,
  queueClient,
  messageValidation,
  processMessage,
  receiveMessageVisibilityTimeout,
  receiveMessageRetry,
  processMessageRetry,
  deleteMessageRetry,
  poisonQueueAddMessageRetry,
}: PollMessageOptions<TValidation>) => {
  const messagesOrErrors = await common.doWithRetry(
    () =>
      queueClient.receiveMessages({
        visibilityTimeout: receiveMessageVisibilityTimeout, // 2 * 60 * 60, // 2 hours timeout. Max is 7days according to documentation.
      }),
    receiveMessageRetry,
  );
  eventEmitter.emit("receivedQueueMessages", messagesOrErrors);
  const receivedMessageItems =
    messagesOrErrors.result === "success"
      ? messagesOrErrors.value.receivedMessageItems
      : undefined;
  if (receivedMessageItems && receivedMessageItems.length > 0) {
    const failedMessages: Array<queue.DequeuedMessageItem> = [];
    const succeededMessages: Array<queue.DequeuedMessageItem> = [];

    for (const msg of receivedMessageItems) {
      let maybeErrors:
        | common.RetryExecutionResult<void>
        | undefined = undefined;
      const { messageText } = msg;
      let messageTextParsed:
        | t.TypeOf<typeof messageValidation>
        | undefined = undefined;
      let parseError: unknown = undefined;
      try {
        messageTextParsed = validation.decodeOrThrow<
          t.TypeOf<typeof messageValidation>,
          unknown
        >(
          messageValidation.decode,
          JSON.parse(
            messageText.substr(0, 1) === "{"
              ? messageText
              : Buffer.from(messageText, "base64").toString(),
          ),
        );
      } catch (e) {
        parseError = e;
      }

      if (messageTextParsed) {
        const theMessage = messageTextParsed; // We have to do this to satisfy compiler
        maybeErrors = await common.doWithRetry(async () => {
          try {
            await processMessage(theMessage);
          } catch (e) {
            eventEmitter.emit("pipelineExecutionError", {
              messageText,
              error: e,
            });
            throw e;
          }
        }, processMessageRetry);
      } else {
        eventEmitter.emit("invalidMessageSeen", { messageText, parseError });
      }

      (maybeErrors?.result === "success"
        ? succeededMessages
        : failedMessages
      ).push(msg);
    }

    for (const msg of receivedMessageItems) {
      const maybeErrors = await common.doWithRetry(
        async () => queueClient.deleteMessage(msg.messageId, msg.popReceipt),
        deleteMessageRetry,
      );
      eventEmitter.emit("deletedFromQueue", maybeErrors);
      if (maybeErrors.result === "error") {
        failedMessages.push(msg);
      }
    }

    for (const failedMessage of failedMessages) {
      eventEmitter.emit(
        "sentToPoisonQueue",
        await common.doWithRetry(
          async () => queueClient.sendMessage(failedMessage.messageText),
          poisonQueueAddMessageRetry,
        ),
      );
    }
  }

  return receivedMessageItems?.length;
};
