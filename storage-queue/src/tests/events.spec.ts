import * as common from "@data-heaving/common";
import * as queue from "@azure/storage-queue";
import * as http from "@azure/core-http";
import test, { ExecutionContext } from "ava";
import * as spec from "../events";

// We must use serial here
test("Test that console logging event emitter works as expected when printing message text", (t) => {
  performConsoleLoggingTest(t, true, undefined);
});

test("Test that console logging event emitter works as expected when NOT printing message text", (t) => {
  performConsoleLoggingTest(t, false, spec.createEventEmitterBuilder()); // We are creating event builder only to get 100% code coverage from events.ts :)
});

const performConsoleLoggingTest = (
  t: ExecutionContext,
  logMessageText: boolean,
  builderToUse:
    | common.EventEmitterBuilder<spec.VirtualQueueMessagesProcesingEvents>
    | undefined,
) => {
  const logsAndErrors: Record<"logs" | "errors", Array<string>> = {
    logs: [],
    errors: [],
  };
  const eventEmitter = spec
    .consoleLoggingEventEmitterBuilder(
      logMessageText,
      undefined,
      builderToUse,
      {
        log: (msg) => logsAndErrors.logs.push(msg),
        error: (msg) => logsAndErrors.errors.push(msg),
      },
    )
    .createEventEmitter();

  const response: http.HttpResponse = {
    headers: new http.HttpHeaders(),
    request: new http.WebResource(),
    status: 200,
  };
  const messageID = "SomeID";
  const messageText = "SomeText";
  const receivedMessageItems: Array<queue.ReceivedMessageItem> = [
    {
      messageId: messageID,
      messageText,
      dequeueCount: 0,
      expiresOn: new Date(),
      insertedOn: new Date(),
      nextVisibleOn: new Date(),
      popReceipt: "PopReceipt",
    },
  ];
  const parsedHeaders = {};
  const bodyAsText = "";
  const errors = [new Error()];

  eventEmitter.emit("receivedQueueMessages", {
    result: "success",
    value: {
      receivedMessageItems,
      _response: {
        ...response,
        parsedHeaders,
        bodyAsText,
        parsedBody: receivedMessageItems,
      },
    },
  });
  const receivedSuccessMessage = `Received ${
    receivedMessageItems.length
  } messages with IDs ${receivedMessageItems
    .map(({ messageId }) => messageId)
    .join(", ")} from queue.`;
  t.deepEqual(logsAndErrors, {
    logs: [receivedSuccessMessage],
    errors: [],
  });

  eventEmitter.emit("receivedQueueMessages", {
    result: "error",
    errors,
  });
  const receivedErrorMessage = `Errors while trying to receive messages: ${errors.join(
    "\n",
  )}.`;
  t.deepEqual(logsAndErrors, {
    logs: [receivedSuccessMessage],
    errors: [receivedErrorMessage],
  });

  eventEmitter.emit("invalidMessageSeen", {
    message: {
      messageID,
      messageText,
    },
    parseError: errors[0],
  });
  const invalidMessageSeenMessage = `Error in parsing message with ID ${messageID}${
    logMessageText ? ` and text "${messageText}"` : ""
  }:\n${errors[0]}`;
  t.deepEqual(logsAndErrors, {
    logs: [receivedSuccessMessage],
    errors: [receivedErrorMessage, invalidMessageSeenMessage],
  });

  eventEmitter.emit("pipelineExecutionComplete", {
    message: {
      messageID,
      messageText,
    },
    result: {
      result: "success",
      value: undefined,
    },
  });
  const pipelineCompletedMessage = `Successfully processed message with ID ${messageID}${
    logMessageText ? ` and text "${messageText}"` : ""
  }`;
  t.deepEqual(logsAndErrors, {
    logs: [receivedSuccessMessage, pipelineCompletedMessage],
    errors: [receivedErrorMessage, invalidMessageSeenMessage],
  });

  eventEmitter.emit("pipelineExecutionComplete", {
    message: {
      messageID,
      messageText,
    },
    result: {
      result: "error",
      errors,
    },
  });
  const pipelineCompletedErrorMessage = `Errors while processing message with ID ${messageID}${
    logMessageText ? ` and text "${messageText}"` : ""
  }: ${errors.join("\n")}.`;
  t.deepEqual(logsAndErrors, {
    logs: [receivedSuccessMessage, pipelineCompletedMessage],
    errors: [
      receivedErrorMessage,
      invalidMessageSeenMessage,
      pipelineCompletedErrorMessage,
    ],
  });

  eventEmitter.emit("deletedFromQueue", {
    message: {
      messageID,
      messageText,
    },
    result: {
      result: "success",
      value: {
        _response: {
          ...response,
          parsedHeaders,
        },
      },
    },
  });
  const deletedFromMessage = `Deleted message ${messageID}${
    logMessageText ? ` with text "${messageText}"` : ""
  } from queue`;
  t.deepEqual(logsAndErrors, {
    logs: [
      receivedSuccessMessage,
      pipelineCompletedMessage,
      deletedFromMessage,
    ],
    errors: [
      receivedErrorMessage,
      invalidMessageSeenMessage,
      pipelineCompletedErrorMessage,
    ],
  });

  eventEmitter.emit("deletedFromQueue", {
    message: {
      messageID,
      messageText,
    },
    result: {
      result: "error",
      errors,
    },
  });
  const deletedFromQueueErrorMessage = `Errors while trying to delete message ${messageID}${
    logMessageText ? ` with text "${messageText}"` : ""
  } from queue: ${errors.join("\n")}`;
  t.deepEqual(logsAndErrors, {
    logs: [
      receivedSuccessMessage,
      pipelineCompletedMessage,
      deletedFromMessage,
    ],
    errors: [
      receivedErrorMessage,
      invalidMessageSeenMessage,
      pipelineCompletedErrorMessage,
      deletedFromQueueErrorMessage,
    ],
  });

  const poisonQueueMessageID = "AnotherID";
  eventEmitter.emit("sentToPoisonQueue", {
    message: {
      messageID,
      messageText,
    },
    result: {
      result: "success",
      value: {
        messageId: poisonQueueMessageID,
        expiresOn: new Date(),
        insertedOn: new Date(),
        nextVisibleOn: new Date(),
        popReceipt: "PoisonPopReceipt",
        _response: {
          ...response,
          parsedHeaders,
          bodyAsText,
          parsedBody: [],
        },
      },
    },
  });
  const sentToPoisonMessage = `Poison queue message for received message ${messageID}${
    logMessageText ? ` with text "${messageText}"` : ""
  } sent: ${poisonQueueMessageID}`;
  t.deepEqual(logsAndErrors, {
    logs: [
      receivedSuccessMessage,
      pipelineCompletedMessage,
      deletedFromMessage,
    ],
    errors: [
      receivedErrorMessage,
      invalidMessageSeenMessage,
      pipelineCompletedErrorMessage,
      deletedFromQueueErrorMessage,
      sentToPoisonMessage,
    ],
  });

  eventEmitter.emit("sentToPoisonQueue", {
    message: {
      messageID,
      messageText,
    },
    result: {
      result: "error",
      errors,
    },
  });
  const sentToPoisonErrorMessage = `Errors when adding message ${messageID}${
    logMessageText ? ` with text "${messageText}"` : ""
  } to poison queue: ${errors.join("\n")}`;
  t.deepEqual(logsAndErrors, {
    logs: [
      receivedSuccessMessage,
      pipelineCompletedMessage,
      deletedFromMessage,
    ],
    errors: [
      receivedErrorMessage,
      invalidMessageSeenMessage,
      pipelineCompletedErrorMessage,
      deletedFromQueueErrorMessage,
      sentToPoisonMessage,
      sentToPoisonErrorMessage,
    ],
  });
};
