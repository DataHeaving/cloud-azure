import * as common from "@data-heaving/common";
import * as events from "./events";
import * as scheduler from "@data-heaving/scheduler";

// TODO Move this to @data-heaving/scheduler
export interface TelemetryClient {
  trackException: (info: { exception: Error }) => unknown;
  trackMetric: (info: { name: string; value: number }) => unknown;
}

export const setupTelemetry = (
  logMessageTexts: boolean,
  queueEvents: common.EventEmitterBuilder<events.VirtualQueueMessagesProcesingEvents>,
  schedulerEvents: scheduler.SchedulerEventBuilder,
  telemetry: TelemetryClient,
  jobID: string,
) => {
  const createNewSingleRunState = () => ({
    receivedMessages: 0,
    processedMessages: 0,
    poisonedMessages: 0,
  });
  let currentRunState = createNewSingleRunState();
  schedulerEvents.addEventListener("jobStarting", () => {
    currentRunState = createNewSingleRunState();
  });

  queueEvents.addEventListener("receivedQueueMessages", (arg) =>
    reportRetryResultMetrics(jobID, telemetry, arg, (receivedMessages) => {
      currentRunState.receivedMessages +=
        receivedMessages.receivedMessageItems.length;
      return undefined;
    }),
  );

  queueEvents.addEventListener("invalidMessageSeen", (arg) => {
    telemetry.trackException({
      exception: new Error(
        `Invalid message with ID ${arg.message.messageID}${
          logMessageTexts
            ? ` and text "${arg.message.messageText}", resulting in error ${arg.parseError}` // Only log error if logMessageTexts is true as we might have sensitive data in parse error message
            : ""
        }`,
      ),
    });
  });

  queueEvents.addEventListener("pipelineExecutionComplete", (arg) =>
    reportRetryResultMetrics(jobID, telemetry, arg.result, undefined),
  );

  queueEvents.addEventListener("deletedFromQueue", (arg) =>
    reportRetryResultMetrics(jobID, telemetry, arg.result, () => {
      ++currentRunState.processedMessages;
      return undefined;
    }),
  );

  queueEvents.addEventListener("sentToPoisonQueue", (arg) =>
    reportRetryResultMetrics(jobID, telemetry, arg.result, () => {
      ++currentRunState.poisonedMessages;
      return undefined;
    }),
  );

  schedulerEvents.addEventListener("jobEnded", () => {
    // Until MS bothers to implement namespace support also to Node library ( it's already existing in .NET), we have to use this ugly way of doing things.
    // More info: https://github.com/microsoft/ApplicationInsights-node.js/issues/609
    const ns = jobID; //telemetry.context.tags[telemetry.context.keys.cloudRole];
    const {
      receivedMessages,
      processedMessages,
      poisonedMessages,
    } = currentRunState;
    telemetry.trackMetric({
      name: `${ns}_ReceivedMessages`,
      value: receivedMessages,
    });
    telemetry.trackMetric({
      name: `${ns}_ProcessedMessages`,
      value: processedMessages,
    });
    telemetry.trackMetric({
      name: `${ns}_PoisonedMessages`,
      value: poisonedMessages,
    });

    if (poisonedMessages > 0) {
      telemetry.trackException({
        exception: new Error(
          `Resulted in ${poisonedMessages} new poisoned messages`,
        ),
      });
    }
    // Remember to reset state
    currentRunState = createNewSingleRunState();
  });
};

const reportRetryResultMetrics = <T>(
  jobID: string,
  telemetry: TelemetryClient,
  result: common.RetryExecutionResult<T>,
  getMetric:
    | ((value: T) => undefined | { name: string; value: number })
    | undefined,
) => {
  if (result.result === "error") {
    for (const error of result.errors) {
      telemetry.trackException({
        exception: error as Error,
      });
    }
  } else {
    // TODO uncomment this once moved to @data-heaving/scheduler
    /*const metricInfo = */ getMetric?.(result.value);
    // if (metricInfo) {
    //   telemetry.trackMetric({
    //     name: `${jobID}_${metricInfo.name}`,
    //     value: metricInfo.value,
    //   });
    // }
  }
};
