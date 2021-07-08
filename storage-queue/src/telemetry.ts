// import * as common from "@data-heaving/common";
// import * as events from "./events";
// import * as scheduler from "@data-heaving/scheduler";

// export interface TelemetryClient {
//   trackException: (info: { exception: Error }) => unknown;
//   trackMetric: (info: { name: string; value: number }) => unknown;
// }

// export const setupTelemetry = (
//   pipelineEvents: common.EventEmitterBuilder<events.VirtualQueueMessagesProcesingEvents>,
//   schedulerEvents: scheduler.SchedulerEventBuilder,
//   telemetry: TelemetryClient,
//   jobID: string,
// ) => {
//   const createNewSingleRunState = () => ({
//     processedMessages: 0,
//     poisonedMessages: 0,
//   });
//   let currentRunState = createNewSingleRunState();
//   schedulerEvents.addEventListener("jobStarting", () => {
//     currentRunState = createNewSingleRunState();
//   });

//   pipelineEvents.addEventListener("receivedQueueMessages", (arg) =>
//     reportRetryResultMetrics(jobID, telemetry, arg, (receivedMessages) => ({
//       name: "ReceivedMessages",
//       value: receivedMessages.receivedMessageItems.length,
//     })),
//   );

//   pipelineEvents.addEventListener("invalidMessageSeen", (arg) => {
//     telemetry.trackException({
//       exception: new Error(`Invalid message ${arg.messageText}`),
//     });
//   });

//   pipelineEvents.addEventListener("pipelineExecutionError", (arg) => {
//     telemetry.trackException({
//       exception: arg.error as Error,
//     });
//   });

//   pipelineEvents.addEventListener("deletedFromQueue", (arg) =>
//     reportRetryResultMetrics(jobID, telemetry, arg, () => {
//       ++currentRunState.processedMessages;
//       return undefined;
//     }),
//   );

//   pipelineEvents.addEventListener("sentToPoisonQueue", (arg) =>
//     reportRetryResultMetrics(jobID, telemetry, arg, () => {
//       ++currentRunState.poisonedMessages;
//       return undefined;
//     }),
//   );

//   schedulerEvents.addEventListener("jobEnded", () => {
//     // Until MS bothers to implement namespace support also to Node library ( it's already existing in .NET), we have to use this ugly way of doing things.
//     // More info: https://github.com/microsoft/ApplicationInsights-node.js/issues/609
//     const ns = jobID; //telemetry.context.tags[telemetry.context.keys.cloudRole];
//     const { processedMessages, poisonedMessages } = currentRunState;
//     telemetry.trackMetric({
//       name: `${ns}_ProcessedMessages`,
//       value: processedMessages,
//     });
//     telemetry.trackMetric({
//       name: `${ns}_PoisonedMessages`,
//       value: poisonedMessages,
//     });

//     if (poisonedMessages > 0) {
//       telemetry.trackException({
//         exception: new Error(
//           `Resulted in ${poisonedMessages} new poisoned messages`,
//         ),
//       });
//     }
//     // Remember to reset state
//     currentRunState = createNewSingleRunState();
//   });
// };

// const reportRetryResultMetrics = <T>(
//   jobID: string,
//   telemetry: TelemetryClient,
//   result: common.RetryExecutionResult<T>,
//   getMetric: (value: T) => undefined | { name: string; value: number },
// ) => {
//   if (result.result === "error") {
//     for (const error of result.errors) {
//       telemetry.trackException({
//         exception: error as Error,
//       });
//     }
//   }
//   //  else if (overrideError !== undefined) {
//   //   telemetry.trackException({
//   //     exception: overrideError as Error,
//   //   });
//   // }
//   else {
//     const metricInfo = getMetric(result.value);
//     if (metricInfo) {
//       telemetry.trackMetric({
//         name: `${jobID}_${metricInfo.name}`,
//         value: metricInfo.value,
//       });
//     }
//   }
// };
