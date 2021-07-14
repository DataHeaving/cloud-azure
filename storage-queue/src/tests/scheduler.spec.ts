import * as t from "io-ts";
import * as common from "@data-heaving/common";
import * as scheduler from "@data-heaving/scheduler";
import * as abi from "../tests-setup/interface";
import { ExecutionContext } from "ava";
import * as spec from "../scheduler";
import * as events from "../events";
import { URL } from "url";

abi.thisTest.serial(
  "Test that omitting telemetry info will result in proper job info",
  async (ctx) => {
    await abi.sendMessages(ctx, ["TestMessage"]);
    await performTest(ctx, {});
    await performTest(ctx, {}, false, {
      overrideReceiveQueueURL: `${ctx.context.queueInfo.receiveQueue.queueURL}/`,
      overridePoisonQueueURL: undefined,
    });
    await performTest(ctx, {}, false, {
      overrideReceiveQueueURL: undefined,
      overridePoisonQueueURL: new URL(
        ctx.context.queueInfo.poisonQueue.queueURL,
      ),
    });
  },
);

abi.thisTest.serial(
  "Test that supplying telemetry info will result in proper job info",
  async (ctx) => {
    const telemetryInfoBase: Omit<
      common.MakeRequired<
        spec.JobCreationOptions<t.Mixed>,
        "telemetryInfo"
      >["telemetryInfo"],
      "logMessageText"
    > = {
      jobID: "JobID",
      client: {
        trackMetric: () => {},
        trackException: () => {},
      },
    };

    const performTestWithLogMessageTextParameter = (logMessageText: boolean) =>
      performTest(ctx, {
        telemetryInfo: {
          ...telemetryInfoBase,
          logMessageText,
        },
      });
    await performTestWithLogMessageTextParameter(true);
    await performTestWithLogMessageTextParameter(false);
  },
);

abi.thisTest.serial(
  "Test that leaked exception is catched to telemetry",
  async (ctx) => {
    const jobID = "JobID";
    const errors: Array<Error> = [];
    const thrownError = new Error("This is error that is leaked to scheduler");
    await abi.sendMessages(ctx, ["TestMessage"]);
    await performTest(
      ctx,
      {
        telemetryInfo: {
          logMessageText: true,
          jobID,
          client: {
            trackMetric: () => {}, // no-op
            trackException: ({ exception }) => errors.push(exception),
          },
        },
        deduplicateMessagesBy: () => {
          throw thrownError;
        },
      },
      true,
    );

    ctx.deepEqual(errors, [thrownError]);
  },
);

const performTest = async (
  ctx: ExecutionContext<abi.StorageQueueTestContext>,
  opts: Partial<
    Pick<
      spec.JobCreationOptions<t.StringC>,
      "timeFromNowToNextInvocation" | "telemetryInfo" | "deduplicateMessagesBy"
    >
  >,
  shouldThrow = false,
  queueCustomization?: {
    overrideReceiveQueueURL: string | URL | undefined;
    overridePoisonQueueURL: string | URL | undefined;
  },
  expectedNextInvocationTime?: number,
) => {
  const {
    job,
    timeFromNowToNextInvocation,
    jobSpecificEvents,
  } = spec.createJobInfo({
    ...opts,
    messageValidation: t.string,
    processMessage: async () => {},
    pollQueueEvents: events.createEventEmitterBuilder(),
    queueInfo: {
      credential: ctx.context.queueInfo.credential,
      queueURL:
        queueCustomization?.overrideReceiveQueueURL ??
        new URL(ctx.context.queueInfo.receiveQueue.queueURL),
      poisonQueueURL: queueCustomization
        ? queueCustomization.overridePoisonQueueURL
        : ctx.context.queueInfo.poisonQueue.queueURL,
    },
  });

  ctx[opts.telemetryInfo ? "false" : "true"](
    jobSpecificEvents === undefined,
    "If no telemetry info is specified, job-specific scheduler events should be undefined",
  );
  const schedulerEvents =
    jobSpecificEvents instanceof common.EventEmitterBuilder
      ? jobSpecificEvents.createEventEmitter()
      : jobSpecificEvents instanceof common.EventEmitter
      ? jobSpecificEvents
      : undefined;
  let messagesProcessed: number | undefined = undefined;
  const error = await (shouldThrow
    ? ctx.throwsAsync(job)
    : ctx.notThrowsAsync(async () => {
        messagesProcessed = await job();
      }));
  const jobEnded: scheduler.VirtualSchedulerEvents["jobEnded"] = {
    name: opts.telemetryInfo?.jobID ?? "",
    durationInMs: 1000,
  };
  if (shouldThrow) {
    jobEnded.error = error!;
  }
  schedulerEvents?.emit("jobEnded", jobEnded);

  if (!shouldThrow) {
    ctx.true(
      messagesProcessed! >= 0,
      "Job must have returned a number which is at least zero.",
    );
  }

  if (opts.timeFromNowToNextInvocation) {
    ctx.deepEqual(
      timeFromNowToNextInvocation(messagesProcessed),
      expectedNextInvocationTime,
      "Time to next invocation must be expected one when supplying custom callback.",
    );
  } else if (!shouldThrow) {
    const firstTime = timeFromNowToNextInvocation(undefined);
    ctx.true(
      firstTime !== undefined && firstTime === 0,
      "First wait time must be zero",
    );

    const timeforNext = timeFromNowToNextInvocation(messagesProcessed);
    ctx.notDeepEqual(
      timeforNext,
      undefined,
      "Default callback to remaining time for next job must return a number",
    );
    ctx.true(
      messagesProcessed! > 0 ? timeforNext! === 0 : timeforNext! > 0,
      "Time to next invocation must be greater than zero, as no messages were processed",
    );
  }
};
