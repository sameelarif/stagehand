import { EvalFunction } from "../../types/evals";
import { initStagehand } from "../utils";
import { z } from "zod";

export const peeler_complex: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  try {
    await stagehand.page.goto(`https://chefstoys.com/`, { timeout: 60000 });

    await stagehand.act({
      action: "search for %search_query%",
      variables: {
        search_query: "peeler",
      },
    });

    await stagehand.act({
      action: 'click on the first "OXO" brand peeler',
    });

    const { price } = await stagehand.extract({
      instruction: "get the price of the peeler",
      schema: z.object({ price: z.number().nullable() }),
      modelName: "gpt-4o-2024-08-06",
    });

    return {
      _success: price === 11.99,
      price,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    logger.error({
      message: "error in peeler_complex function",
      level: 0,
      auxiliary: {
        error: {
          value: JSON.stringify(error, null, 2),
          type: "object",
        },
        trace: {
          value: error.stack,
          type: "string",
        },
      },
    });
    return {
      _success: false,
      error: JSON.parse(JSON.stringify(error, null, 2)),
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await stagehand.context.close();
  }
};
