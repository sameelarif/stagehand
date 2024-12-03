import { EvalFunction } from "../../types/evals";
import { initStagehand } from "../utils";
import { z } from "zod";

export const extract_partners: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  try {
    await stagehand.page.goto("https://ramp.com");

    await stagehand.act({
      action: "Close the popup.",
    });

    await stagehand.act({
      action: "Scroll down to the bottom of the page.",
    });

    await stagehand.act({
      action:
        "Click on the link or button that leads to the partners page. If it's in a dropdown or hidden section, first interact with the element to reveal it, then click the link.",
    });

    const partners = await stagehand.extract({
      instruction: `
      Extract the names of all partner companies mentioned on this page.
      These could be inside text, links, or images representing partner companies.
      If no specific partner names are found, look for any sections or categories of partners mentioned.
      Also, check for any text that explains why partner names might not be listed, if applicable.
    `,
      schema: z.object({
        partners: z.array(
          z.object({
            name: z
              .string()
              .describe(
                "The name of the partner company or category of partners",
              ),
          }),
        ),
        explanation: z
          .string()
          .optional()
          .describe("Any explanation about partner listing or absence thereof"),
      }),
    });

    const expectedPartners = [
      "Accounting Partners",
      "Private Equity & Venture Capital Partners",
      "Services Partners",
      "Affiliates",
    ];

    const foundPartners = partners.partners.map((partner) =>
      partner.name.toLowerCase(),
    );

    const allExpectedPartnersFound = expectedPartners.every((partner) =>
      foundPartners.includes(partner.toLowerCase()),
    );

    return {
      _success: allExpectedPartnersFound,
      partners,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    logger.error({
      message: "error in extractPartners function",
      level: 0,
      auxiliary: {
        error: {
          value: error.message,
          type: "string",
        },
        trace: {
          value: error.stack,
          type: "string",
        },
      },
    });
    return {
      _success: false,
      debugUrl,
      sessionUrl,
      error: JSON.parse(JSON.stringify(error, null, 2)),
      logs: logger.getLogs(),
    };
  } finally {
    await stagehand.context.close();
  }
};
