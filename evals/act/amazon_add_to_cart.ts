import { EvalFunction } from "../../types/evals";
import { initStagehand } from "../utils";

export const amazon_add_to_cart: EvalFunction = async ({
  modelName,
  logger,
}) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  await stagehand.page.goto(
    "https://www.amazon.com/Laptop-MacBook-Surface-Water-Resistant-Accessories/dp/B0D5M4H5CD",
  );

  await stagehand.page.waitForTimeout(5000);

  await stagehand.act({
    action: "click the 'Add to Cart' button",
  });

  await stagehand.page.waitForTimeout(2000);

  await stagehand.act({
    action: "click the 'Proceed to checkout' button",
  });

  await stagehand.page.waitForTimeout(2000);
  const currentUrl = stagehand.page.url();
  const expectedUrlPrefix = "https://www.amazon.com/ap/signin";

  await stagehand.context.close();

  return {
    _success: currentUrl.startsWith(expectedUrlPrefix),
    currentUrl,
    debugUrl,
    sessionUrl,
    logs: logger.getLogs(),
  };
};
