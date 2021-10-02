import * as t from "io-ts";

export const graphAPIListOf = <TType extends t.Mixed>(item: TType) =>
  t.type(
    // Also typically has "@odata.context" attribute but
    {
      value: t.array(item, `${item.name}List`),
    },
    "APIResult",
  );

export const doThrow = <T>(message: string): T => {
  throw new Error(message);
};
