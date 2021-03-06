import * as t from "io-ts";
import * as queue from "@azure/storage-queue";
import * as auth from "@azure/core-auth";
import { URL } from "url";
import * as scheduler from "@data-heaving/scheduler";
import * as events from "./events";
import * as poll from "./poll-queue";
import * as telemetry from "./telemetry";

export type JobInfo = scheduler.JobInfo<number | undefined>;
export type JobCreationOptions<TValidation extends t.Mixed> = Pick<
  poll.PollMessageOptions<TValidation>,
  "messageValidation" | "processMessage" | "deduplicateMessagesBy"
> &
  Pick<Partial<JobInfo>, "timeFromNowToNextInvocation"> & {
    pollQueueEvents: events.EventEmitterBuilder;
    queueInfo: {
      credential:
        | queue.StorageSharedKeyCredential
        | queue.AnonymousCredential
        | auth.TokenCredential;
      queueURL: string | URL;
      poisonQueueURL?: string | URL;
    };
    telemetryInfo?: {
      logMessageText: boolean;
      client: telemetry.TelemetryClient;
      jobID: string;
      schedulerEvents?: scheduler.SchedulerEventBuilder;
    };
    // All intervals in seconds
    pollInterval?: {
      afterSomeMessages: number;
      afterNoMessages: number;
      initial: number;
    };
  };
export const createJobInfo = <TValidation extends t.Mixed>({
  timeFromNowToNextInvocation,
  messageValidation,
  processMessage,
  deduplicateMessagesBy,
  pollQueueEvents,
  queueInfo: { credential, queueURL, poisonQueueURL },
  telemetryInfo,
  pollInterval,
}: JobCreationOptions<TValidation>): JobInfo => {
  let jobSpecificEvents:
    | scheduler.SchedulerEventBuilder
    | undefined = undefined;
  if (telemetryInfo) {
    // TODO move this telemetry part to @data-heaving/scheduler project
    const { client: telemetryClient, jobID, logMessageText } = telemetryInfo;
    // Notice! This event emitter builder is *specific to this job*, and will not have auto-registered console-emitting event handlers. We use it only for telemetry.
    jobSpecificEvents =
      telemetryInfo.schedulerEvents ?? scheduler.createEventEmitterBuilder();
    jobSpecificEvents.addEventListener(
      "jobEnded",
      ({ durationInMs, ...arg }) => {
        telemetryClient.trackMetric({
          name: `${jobID}_Duration`,
          value: durationInMs,
        });
        if ("error" in arg) {
          telemetryClient.trackException({
            exception: arg.error!,
          });
        }
      },
    );
    telemetry.setupTelemetry(
      logMessageText,
      pollQueueEvents,
      jobSpecificEvents,
      telemetryClient,
      jobID,
    );
  }
  const queueURLString =
    queueURL instanceof URL ? queueURL.toString() : queueURL;
  const pollOptions = poll.getOptionsWithDefaults({
    eventEmitter: pollQueueEvents.createEventEmitter(),
    messageValidation,
    processMessage,
    deduplicateMessagesBy,
    queueClient: new queue.QueueClient(queueURLString, credential),
    poisonQueueClient: new queue.QueueClient(
      poisonQueueURL instanceof URL
        ? poisonQueueURL.toString()
        : poisonQueueURL ?? `${trimAllEnd(queueURLString, "/")}-poison`,
      credential,
    ),
  });
  return {
    timeFromNowToNextInvocation:
      timeFromNowToNextInvocation ??
      ((prevResult) =>
        typeof prevResult === "number"
          ? prevResult > 0
            ? (pollInterval?.afterSomeMessages ?? 0) * 1000
            : (pollInterval?.afterNoMessages ?? 15) * 1000 // If previous result (amount of queue messages processed) was > 0, rerun immediately (greedy queue-emptying algorithm). Otherwise, wait 15secs.
          : (pollInterval?.initial ?? 0) * 1000),
    job: () => poll.pollMessagesOnce(pollOptions),
    jobSpecificEvents,
  };
};

// It's silly that JS doesn't have custom-string trim methods for strings, e.g. xyz.trim("/")
const trimAllEnd = (str: string, trimmable: string) => {
  while (str.endsWith(trimmable)) {
    str = str.substr(0, str.length - trimmable.length);
  }
  return str;
};
