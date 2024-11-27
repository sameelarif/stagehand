import { Stagehand } from "../lib";
import { z } from "zod";

async function example() {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 1,
    debugDom: true,
    enableCaching: false,
  });

  await stagehand.init();
  await stagehand.page.goto("https://abrahamjuliot.github.io/creepjs/");
  const score = await stagehand.extract({
    instruction: "extract the trust score",
    schema: z.object({
      score: z.number(),
    }),
  });
  console.log(`The trust score is ${score.score}`);
}

(async () => {
  await example();
})();
