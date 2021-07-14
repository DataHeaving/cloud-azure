import * as queue from "@azure/storage-queue";
import * as t from "io-ts";
import * as common from "@data-heaving/common";
import * as validation from "@data-heaving/common-validation";
import * as events from "./events";

export interface PollMessageOptions<TValidation extends t.Mixed> {
  eventEmitter: events.EventEmitter;
  queueClient: queue.QueueClient;
  poisonQueueClient: queue.QueueClient;
  messageValidation: TValidation;
  processMessage: (
    parsedMessage: t.TypeOf<TValidation>,
    queueMessageID: string,
  ) => Promise<unknown>;
  receiveMessageVisibilityTimeout: number;
  receiveMessageRetry: number;
  processMessageRetry: number;
  deleteMessageRetry: number;
  poisonQueueAddMessageRetry: number;
  deduplicateMessagesBy?: (msg: t.TypeOf<TValidation>) => string;
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
  receiveMessageRetry: 3,
  processMessageRetry: 3,
  deleteMessageRetry: 3,
  poisonQueueAddMessageRetry: 3,
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
  poisonQueueClient,
  messageValidation,
  processMessage,
  receiveMessageVisibilityTimeout,
  receiveMessageRetry,
  processMessageRetry,
  deleteMessageRetry,
  poisonQueueAddMessageRetry,
  deduplicateMessagesBy,
}: PollMessageOptions<TValidation>) => {
  const messagesOrErrors = await common.doWithRetry(
    () =>
      queueClient.receiveMessages({
        visibilityTimeout: receiveMessageVisibilityTimeout, // 2 * 60 * 60, // 2 hours timeout. Max is 7days according to documentation.
        numberOfMessages: 32,
      }),
    receiveMessageRetry,
  );
  eventEmitter.emit("receivedQueueMessages", messagesOrErrors);
  const receivedMessageItems =
    messagesOrErrors.result === "success"
      ? messagesOrErrors.value.receivedMessageItems
      : undefined;
  if (receivedMessageItems && receivedMessageItems.length > 0) {
    const failedMessages: Array<events.MessageInfo> = [];
    const succeededMessages: Array<events.MessageInfo> = [];

    const parsedMessages = receivedMessageItems
      .map(({ messageId, messageText }) => {
        const message = {
          messageID: messageId,
          messageText,
        };
        let messageTextParsed:
          | t.TypeOf<typeof messageValidation>
          | undefined = undefined;
        let parseError: unknown = undefined;
        let success = false;
        try {
          messageTextParsed = validation.decodeOrThrow<
            t.TypeOf<typeof messageValidation>,
            unknown
          >(
            messageValidation.decode,
            JSON.parse(
              messageText.substr(0, 1) === "{" ||
                messageText.substr(0, 1) === '"'
                ? messageText
                : Buffer.from(messageText, "base64").toString(),
            ),
          );
          success = true;
        } catch (e) {
          parseError = e;
        }
        if (!success) {
          eventEmitter.emit("invalidMessageSeen", { message, parseError });
          failedMessages.push(message);
        }

        return success ? { message, messageTextParsed } : undefined;
      })
      .filter(
        (
          info,
        ): info is {
          message: events.MessageInfo;
          messageTextParsed: t.TypeOf<typeof messageValidation>;
        } => !!info,
      );

    if (deduplicateMessagesBy) {
      const deduplicatedMessages = parsedMessages.reduce<
        Record<string, Array<typeof parsedMessages[number]>>
      >((dict, current) => {
        common
          .getOrAddGeneric(
            dict,
            deduplicateMessagesBy(current.messageTextParsed),
            () => [],
          )
          .push(current);
        return dict;
      }, {});
      parsedMessages.length = 0;
      for (const [messageKey, messages] of Object.entries(
        deduplicatedMessages,
      )) {
        eventEmitter.emit("deduplicatedMessages", {
          messageKey,
          messages: messages.map(({ message }) => message),
        });
        parsedMessages.push(messages[0]);
      }
    }

    for (const { message, messageTextParsed } of parsedMessages) {
      let maybeErrors:
        | common.RetryExecutionResult<unknown>
        | undefined = undefined;

      maybeErrors = await common.doWithRetry(
        () => processMessage(messageTextParsed, message.messageID),
        processMessageRetry,
      );
      eventEmitter.emit("pipelineExecutionComplete", {
        message,
        result: maybeErrors,
      });
      (maybeErrors.result === "success"
        ? succeededMessages
        : failedMessages
      ).push(message);
    }

    for (const msg of receivedMessageItems) {
      const message = {
        messageID: msg.messageId,
        messageText: msg.messageText,
      };
      const maybeErrors = {
        message: message,
        result: await common.doWithRetry(
          () => queueClient.deleteMessage(msg.messageId, msg.popReceipt),
          deleteMessageRetry,
        ),
      };
      eventEmitter.emit("deletedFromQueue", maybeErrors);
      if (maybeErrors.result.result === "error") {
        failedMessages.push(message);
      }
    }

    for (const failedMessage of failedMessages) {
      eventEmitter.emit("sentToPoisonQueue", {
        message: {
          messageID: failedMessage.messageID,
          messageText: failedMessage.messageText,
        },
        result: await common.doWithRetry(
          () => poisonQueueClient.sendMessage(failedMessage.messageText),
          poisonQueueAddMessageRetry,
        ),
      });
    }
  }

  return receivedMessageItems?.length;
};
