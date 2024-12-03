import { EvalFunction } from "../../types/evals";
import { initStagehand } from "../utils";

export const expedia: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  try {
    await stagehand.page.goto("https://www.expedia.com/flights");
    await stagehand.act({
      action:
        "find round-trip flights from San Francisco (SFO) to Toronto (YYZ) for Jan 1, 2025 (up to one to two weeks)",
    });
    await stagehand.act({ action: "Go to the first non-stop flight" });
    await stagehand.act({ action: "select the cheapest flight" });
    await stagehand.act({ action: "click on the first non-stop flight" });
    await stagehand.act({ action: "Take me to the checkout page" });

    const url = stagehand.page.url();
    return {
      _success: url.startsWith("https://www.expedia.com/Checkout/"),
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  } catch (error) {
    // ... error handling
  } finally {
    await stagehand.context.close();
  }
};
