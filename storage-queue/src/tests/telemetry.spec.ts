import * as scheduler from "@data-heaving/scheduler";
import * as queue from "@azure/storage-queue";
import * as http from "@azure/core-http";
import test, { ExecutionContext } from "ava";
import * as spec from "../telemetry";
import * as events from "../events";

test("Test that normal execution logs necessary telemetry", (ctx) => {
  runOneMessageTestWithCustomizableFlow(ctx);
});

test("Test that execution with errors logs necessary exceptions", (ctx) => {
  const errors = [new Error()];
  runOneMessageTestWithCustomizableFlow(ctx, {
    simulateEvents: (
      logMessageTexts,
      eventEmitter,
      message,
      response,
      bodyAsText,
    ) => {
      eventEmitter.emit("receivedQueueMessages", {
        result: "error",
        errors,
      });
      eventEmitter.emit("invalidMessageSeen", {
        message,
        parseError: errors[0],
      });
      eventEmitter.emit("pipelineExecutionComplete", {
        message,
        result: {
          result: "error",
          errors,
        },
      });
      eventEmitter.emit("deletedFromQueue", {
        message,
        result: {
          result: "error",
          errors,
        },
      });
      eventEmitter.emit("sentToPoisonQueue", {
        message,
        result: {
          result: "success",
          value: {
            _response: {
              ...response,
              bodyAsText,
              parsedBody: [],
              parsedHeaders: {},
            },
            messageId: "PoisonMessageID",
            popReceipt: "PoisonPopReceipt",
            insertedOn: new Date(),
            nextVisibleOn: new Date(),
            expiresOn: new Date(),
          },
        },
      });
      eventEmitter.emit("sentToPoisonQueue", {
        message,
        result: {
          result: "error",
          errors,
        },
      });
    },
    expectedTelemetry: (logMessageTexts, jobID, message) => ({
      trackMetric: new Set([
        {
          name: `${jobID}_ReceivedMessages`,
          value: 0,
        },
        {
          name: `${jobID}_ProcessedMessages`,
          value: 0,
        },
        {
          name: `${jobID}_PoisonedMessages`,
          value: 1,
        },
      ]),
      // Ava doesn't know to compare sets ignoring order so we have to specify correct order here
      trackException: new Set([
        {
          exception: errors[0],
        },
        {
          exception: new Error(
            `Invalid message with ID ${message.messageID}${
              logMessageTexts
                ? ` and text "${message.messageText}", resulting in error ${errors[0]}` // Only log error if logMessageTexts is true as we might have sensitive data in parse error message
                : ""
            }`,
          ),
        },
        {
          exception: errors[0],
        },
        {
          exception: errors[0],
        },
        {
          exception: errors[0],
        },
        {
          exception: new Error("Resulted in 1 new poisoned messages"),
        },
      ]),
    }),
  });
});

const runOneMessageTestWithCustomizableFlow = (
  ctx: ExecutionContext,
  customFlow?: {
    simulateEvents: (
      logMessageTexts: boolean,
      eventEmitter: events.EventEmitter,
      message: events.MessageInfo,
      response: http.HttpResponse,
      bodyAsText: string,
      queueMessages: Array<queue.DequeuedMessageItem>,
    ) => void;
    expectedTelemetry: (
      logMessageTexts: boolean,
      jobID: string,
      message: events.MessageInfo,
    ) => Partial<TelemetryTracker>;
  },
) => {
  const response: http.HttpResponse = {
    headers: new http.HttpHeaders(),
    request: new http.WebResource(),
    status: 200,
  };
  const parsedHeaders = {};
  const bodyAsText = "";
  const queueMessage: queue.DequeuedMessageItem = {
    messageId: "SomeID",
    messageText: "SomeMessage",
    dequeueCount: 0,
    expiresOn: new Date(),
    insertedOn: new Date(),
    nextVisibleOn: new Date(),
    popReceipt: "PopReceipt",
  };
  const messages = [queueMessage];
  const message = {
    messageID: queueMessage.messageId,
    messageText: queueMessage.messageText,
  };
  const doRunTest = (logMessageTexts: boolean) =>
    runTest(
      ctx,
      logMessageTexts,
      (eventEmitter) => {
        if (customFlow) {
          customFlow.simulateEvents(
            logMessageTexts,
            eventEmitter,
            message,
            response,
            bodyAsText,
            messages,
          );
        } else {
          eventEmitter.emit("receivedQueueMessages", {
            result: "success",
            value: {
              _response: {
                ...response,
                parsedHeaders,
                bodyAsText,
                parsedBody: messages,
              },
              receivedMessageItems: messages,
            },
          });
          eventEmitter.emit("pipelineExecutionComplete", {
            message,
            result: {
              result: "success",
              value: undefined,
            },
          });

          // This event will cause telemetry to increment the _ProcessedMessages
          eventEmitter.emit("deletedFromQueue", {
            message,
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
        }
      },
      (jobID) => {
        return customFlow
          ? customFlow.expectedTelemetry(logMessageTexts, jobID, message)
          : {
              trackMetric: new Set([
                {
                  name: `${jobID}_ReceivedMessages`,
                  value: messages.length,
                },
                {
                  name: `${jobID}_ProcessedMessages`,
                  value: messages.length,
                },
                {
                  name: `${jobID}_PoisonedMessages`,
                  value: 0,
                },
              ]),
            };
      },
    );
  doRunTest(true);
  doRunTest(false);
};

export type TelemetryTracker = {
  // Unlike event tracking, we are not interested in chronological order, but rather end result
  [P in keyof spec.TelemetryClient]: Set<
    Parameters<spec.TelemetryClient[P]>[0]
  >;
};

const runTest = (
  ctx: ExecutionContext,
  logMessageTexts: boolean,
  simulateEvents: (eventEmitter: events.EventEmitter) => void,
  expectedTelemetry: (jobID: string) => Partial<TelemetryTracker>,
) => {
  const queueEvents = events.createEventEmitterBuilder();
  const schedulerEventsBuilder = scheduler.createEventEmitterBuilder();
  const tracker: TelemetryTracker = {
    trackMetric: new Set<Parameters<spec.TelemetryClient["trackMetric"]>[0]>(),
    trackException: new Set<
      Parameters<spec.TelemetryClient["trackException"]>[0]
    >(),
  };
  const jobID = "TestJob";
  spec.setupTelemetry(
    logMessageTexts,
    queueEvents,
    schedulerEventsBuilder,
    {
      trackMetric: (metric) => tracker.trackMetric.add(metric),
      trackException: (exception) => tracker.trackException.add(exception),
    },
    jobID,
  );
  const schedulerEvents = schedulerEventsBuilder.createEventEmitter();

  schedulerEvents.emit("jobStarting", { name: jobID }); // This will trigger internal telemetry mechanisms to start collecting data
  let seenError: Error | undefined = undefined;
  try {
    simulateEvents(queueEvents.createEventEmitter());
  } catch (e) {
    seenError = e as Error;
  } finally {
    const endArg: scheduler.VirtualSchedulerEvents["jobEnded"] = {
      name: jobID,
      durationInMs: 1, // Will not be used by telemetry
    };
    if (seenError) {
      endArg.error = seenError;
    }
    schedulerEvents.emit("jobEnded", endArg); // This will trigger internal telemetry mechanisms to end collecting data for this run
  }

  ctx.deepEqual(tracker, {
    ...{ trackMetric: new Set([]), trackException: new Set([]) },
    ...expectedTelemetry(jobID),
  });
};
