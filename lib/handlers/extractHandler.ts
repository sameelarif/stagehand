import { AvailableModel, LLMProvider } from "../llm/LLMProvider";
import { Stagehand } from "../index";
import { z } from "zod";
import { LogLine, TextAnnotation } from "../types";
import { extract } from "../inference";
import { formatText } from "../utils";

export class StagehandExtractHandler {
  private readonly stagehand: Stagehand;

  private readonly logger: (logLine: LogLine) => void;
  private readonly waitForSettledDom: (
    domSettleTimeoutMs?: number,
  ) => Promise<void>;
  private readonly startDomDebug: () => Promise<void>;
  private readonly cleanupDomDebug: () => Promise<void>;
  private readonly defaultModelName: AvailableModel;
  private readonly llmProvider: LLMProvider;
  private readonly verbose: 0 | 1 | 2;

  constructor({
    stagehand,
    logger,
    waitForSettledDom,
    defaultModelName,
    startDomDebug,
    cleanupDomDebug,
    llmProvider,
    verbose,
  }: {
    stagehand: Stagehand;
    logger: (message: {
      category?: string;
      message: string;
      level?: number;
      auxiliary?: { [key: string]: { value: string; type: string } };
    }) => void;
    waitForSettledDom: (domSettleTimeoutMs?: number) => Promise<void>;
    defaultModelName: AvailableModel;
    startDomDebug: () => Promise<void>;
    cleanupDomDebug: () => Promise<void>;
    llmProvider: LLMProvider;
    verbose: 0 | 1 | 2;
  }) {
    this.stagehand = stagehand;
    this.logger = logger;
    this.waitForSettledDom = waitForSettledDom;
    this.defaultModelName = defaultModelName;
    this.startDomDebug = startDomDebug;
    this.cleanupDomDebug = cleanupDomDebug;
    this.llmProvider = llmProvider;
  }

  public async extract<T extends z.AnyZodObject>({
    instruction,
    schema,
    content = {},
    modelName,
    requestId,
    domSettleTimeoutMs,
  }: {
    instruction: string;
    schema: T;
    content?: z.infer<T>;
    modelName?: AvailableModel;
    requestId?: string;
    domSettleTimeoutMs?: number;
  }): Promise<z.infer<T>> {
    this.logger({
      category: "extraction",
      message: "starting extraction",
      level: 1,
      auxiliary: {
        instruction: {
          value: instruction,
          type: "string",
        },
      },
    });

    await this.waitForSettledDom(domSettleTimeoutMs);
    await this.startDomDebug();
    const originalDOM: string = await this.stagehand.page.evaluate(
      () => window.storeDOM(),
    );

    const { selectorMap }: { selectorMap: Record<number, string[]> } =
      await this.stagehand.page.evaluate(() => window.processAllOfDom());

    this.logger({
      category: "extraction",
      message: `received output from processAllOfDom. selectorMap has ${Object.keys(selectorMap).length} entries`,
    });

    await this.stagehand.page.evaluate(() => window.createTextBoundingBoxes());
    const seenAnnotations = new Set<string>();
    const textAnnotations: TextAnnotation[] = [];

    for (const xpaths of Object.values(selectorMap)) {
      const xpath = xpaths[0];

      const boundingBoxes: Array<{
        text: string;
        left: number;
        top: number;
        width: number;
        height: number;
      }> = await this.stagehand.page.evaluate(
        (xpath) => window.getElementBoundingBoxes(xpath),
        xpath
      );

      for (const box of boundingBoxes) {
        const annotationKey = JSON.stringify({
          text: box.text,
          x: box.left + box.width / 2,
          y: box.top + box.height / 2,
          width: box.width,
          height: box.height,
        });

        if (!seenAnnotations.has(annotationKey)) {
          seenAnnotations.add(annotationKey);
          textAnnotations.push({
            text: box.text,
            midpoint: {
              x: box.left,
              y: box.top + box.height,
            },
            midpoint_normalized: {
              x: box.left / this.stagehand.page.viewportSize().width,
              y: box.top + box.height / this.stagehand.page.viewportSize().height,
            },
            width: box.width,
            height: box.height,
          });
        }
      }
    }

    await this.stagehand.page.evaluate(
      (dom) => window.restoreDOM(dom),
      originalDOM
    );

    const formattedText = formatText(textAnnotations);

    // const fs = require("fs");
    // const formattedTextFilePath = "./formattedText.txt";
    // fs.writeFileSync(formattedTextFilePath, formattedText);


    const extractionResponse = await extract({
      instruction,
      previouslyExtractedContent: content,
      domElements: formattedText,
      llmProvider: this.llmProvider,
      schema,
      modelName: modelName || this.defaultModelName,
      requestId,
    });

    const {
      metadata: { completed },
      ...output
    } = extractionResponse;
    await this.cleanupDomDebug();

    this.logger({
      category: "extraction",
      message: "received extraction response",
      auxiliary: {
        extraction_response: {
          value: JSON.stringify(extractionResponse),
          type: "object",
        },
      },
    });

    if (completed) {
      this.logger({
        category: "extraction",
        message: "got response",
        auxiliary: {
          extraction_response: {
            value: JSON.stringify(extractionResponse),
            type: "object",
          },
        },
      });

      return output;
    } 

    throw new Error("Extraction not completed");
  }
}
