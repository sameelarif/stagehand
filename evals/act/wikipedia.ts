import { EvalFunction } from "../../types/evals";
import { initStagehand } from "../utils";

export const wikipedia: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  await stagehand.page.goto(`https://en.wikipedia.org/wiki/Baseball`);
  await stagehand.act({
    action: 'click the "hit and run" link in this article',
  });

  const url = "https://en.wikipedia.org/wiki/Hit_and_run_(baseball)";
  const currentUrl = stagehand.page.url();
  await stagehand.context.close();

  return {
    _success: currentUrl === url,
    expected: url,
    actual: currentUrl,
    debugUrl,
    sessionUrl,
    logs: logger.getLogs(),
  };
};
