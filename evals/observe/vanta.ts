import { initStagehand } from "../utils";
import { EvalFunction } from "../../types/evals";

export const vanta: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  await stagehand.page.goto("https://www.vanta.com/");

  const observations = await stagehand.observe();

  if (observations.length === 0) {
    await stagehand.context.close();
    return {
      _success: false,
      observations,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  }

  const expectedLocator = `body > div.page-wrapper > div.nav_component > div.nav_element.w-nav > div.padding-global > div > div > nav > div.nav_cta-wrapper.is-new > a.nav_cta-button-desktop.is-smaller.w-button`;

  const expectedResult = await stagehand.page
    .locator(expectedLocator)
    .first()
    .innerHTML();

  let foundMatch = false;
  for (const observation of observations) {
    try {
      const observationResult = await stagehand.page
        .locator(observation.selector)
        .first()
        .innerHTML();

      if (observationResult === expectedResult) {
        foundMatch = true;
        break;
      }
    } catch (error) {
      console.warn(
        `Failed to check observation with selector ${observation.selector}:`,
        error.message,
      );
      continue;
    }
  }

  await stagehand.context.close();

  return {
    _success: foundMatch,
    expected: expectedResult,
    observations,
    debugUrl,
    sessionUrl,
    logs: logger.getLogs(),
  };
};
