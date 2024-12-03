import { Eval } from "braintrust";
import fs from "fs";
import process from "process";
import { EvalFunction } from "../types/evals";
import { AvailableModel } from "../types/model";
import { amazon_add_to_cart } from "./act/amazon_add_to_cart";
import { expedia_search } from "./act/expedia_search";
import { laroche_form } from "./act/laroche_form";
import { peeler_simple } from "./act/peeler_simple";
import { simple_google_search } from "./act/simple_google_search";
import { wikipedia } from "./act/wikipedia";
import { arxiv } from "./combination/arxiv";
import { extract_partners } from "./combination/extract_partners";
import { google_jobs } from "./combination/google_jobs";
import { homedepot } from "./combination/homedepot";
import { peeler_complex } from "./combination/peeler_complex";
import { extract_collaborators } from "./extract/extract_collaborators";
import { extract_github_commits } from "./extract/extract_github_commits";
import { extract_github_stars } from "./extract/extract_github_stars";
import { extract_press_releases } from "./extract/extract_press_releases";
import { costar } from "./observe/costar";
import { vanta } from "./observe/vanta";
import { vanta_h } from "./observe/vanta_h";
import { EvalLogger } from "./utils";

const env: "BROWSERBASE" | "LOCAL" =
  process.env.EVAL_ENV?.toLowerCase() === "browserbase"
    ? "BROWSERBASE"
    : "LOCAL";

const models: AvailableModel[] = ["gpt-4o", "claude-3-5-sonnet-20241022"];

const tasks: Record<string, EvalFunction> = {
  vanta,
  vanta_h,
  peeler_simple,
  peeler_complex,
  wikipedia,
  simple_google_search,
  extract_github_stars,
  extract_collaborators,
  extract_github_commits,
  costar,
  google_jobs,
  homedepot,
  extract_partners,
  laroche_form,
  arxiv,
  expedia_search,
  amazon_add_to_cart,
  extract_press_releases,
};

const exactMatch = (args: {
  input: any;
  output: any;
  expected?: any;
}): {
  name: string;
  score: number;
} => {
  console.log(`Task "${args.input.name}" returned: ${args.output}`);

  const expected = args.expected ?? true;
  if (expected === true) {
    return {
      name: "Exact match",
      score: args.output === true || args.output?._success == true ? 1 : 0,
    };
  }

  return {
    name: "Exact match",
    score: args.output === expected ? 1 : 0,
  };
};

const errorMatch = (args: {
  input: any;
  output: any;
  expected?: any;
}): {
  name: string;
  score: number;
} => {
  console.log(`Task "${args.input.name}" returned: ${args.output}`);

  return {
    name: "Error rate",
    score: args.output?.error !== undefined ? 1 : 0,
  };
};

const testcases = [
  "vanta",
  "vanta_h",
  ...(env === "BROWSERBASE" ? [] : ["peeler_simple"]), // peeler_simple is not supported on Browserbase
  "wikipedia",
  "peeler_complex",
  "simple_google_search",
  "extract_github_stars",
  "extract_collaborators_from_github_repository",
  "extract_last_twenty_github_commits",
  "google_jobs",
  "homedepot",
  "extract_partners",
  "laroche_form",
  "arxiv",
  "amazon_add_to_cart",
  "extract_press_releases",
  "expedia_search",
];

const generateSummary = async (summary: any, results: any[]) => {
  const exactMatch = summary.scores?.["Exact match"] || { score: null };

  const taskStatuses = results.map((result) => ({
    name: result.input.name,
    modelName: result.input.modelName,
    success: result.output?._success || false,
  }));

  const totalTasks = taskStatuses.length;

  const passedTasks = taskStatuses
    .filter((task) => task.success)
    .map((task) => ({ name: task.name, modelName: task.modelName }));
  const failedTasks = taskStatuses
    .filter((task) => !task.success)
    .map((task) => ({ name: task.name, modelName: task.modelName }));

  const formattedSummary = {
    exactMatchScore: exactMatch.score !== null ? exactMatch.score * 100 : null,
    totalTasks,
    passedTasks,
    failedTasks,
  };

  fs.writeFileSync(
    "eval-summary.json",
    JSON.stringify(formattedSummary, null, 2),
  );
  console.log("Evaluation summary written to eval-summary.json");
};

const ciEvals = process.env.CI_EVALS?.split(",").map((e) => e.trim());

const args = process.argv.slice(2);
const filter = args[0];

(async () => {
  try {
    const evalResult = await Eval("stagehand", {
      data: () => {
        let allTestcases = models.flatMap((model) =>
          testcases.flatMap((test) => ({
            input: { name: test, modelName: model },
            name: test,
            tags: [model, test],
            metadata: {
              model,
              test,
            },
          })),
        );

        if (ciEvals && ciEvals.length > 0) {
          allTestcases = allTestcases.filter((testcase) =>
            ciEvals.includes(testcase.name),
          );
        }

        if (filter) {
          allTestcases = allTestcases.filter(
            (testcase) =>
              testcase.name === filter || testcase.input.name === filter,
          );
        }

        return allTestcases;
      },
      task: async (input: {
        name: keyof typeof tasks;
        modelName: AvailableModel;
      }) => {
        const logger = new EvalLogger();
        try {
          // Handle predefined tasks
          const result = await tasks[input.name]({
            modelName: input.modelName,
            logger,
          });
          if (result && result._success) {
            console.log(`✅ ${input.name}: Passed`);
          } else {
            console.log(`❌ ${input.name}: Failed`);
          }
          return result;
        } catch (error) {
          console.error(`❌ ${input.name}: Error - ${error}`);
          logger.error({
            message: `Error in task ${input.name}`,
            level: 0,
            auxiliary: {
              error: {
                value: error,
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
            logs: logger.getLogs(),
          };
        }
      },
      scores: [exactMatch, errorMatch],
      maxConcurrency: 20,
      trialCount: 5,
    });

    await generateSummary(evalResult.summary, evalResult.results);
  } catch (error) {
    console.error("Error during evaluation run:", error);
    process.exit(1);
  }
})();
