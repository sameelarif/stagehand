import crypto from "crypto";
import { LogLine } from "./types";
import { TextAnnotation } from "./types";

export function generateId(operation: string) {
  return crypto.createHash("sha256").update(operation).digest("hex");
}

export function formatText(textAnnotations: TextAnnotation[]): string {
  // cluster tokens by line
  const lineCluster: Map<number, TextAnnotation[]> = new Map();
  const lineThreshold = 10;

  // sort annotations by their Y-coordinate
  const sortedAnnotations = textAnnotations.sort((a, b) => a.midpoint.y - b.midpoint.y);

  sortedAnnotations.forEach((annotation) => {
    const lineY = annotation.midpoint.y;
    const keys = Array.from(lineCluster.keys());
    const lastY = keys[keys.length - 1];

    if (keys.length > 0 && Math.abs(lineY - lastY) < lineThreshold) {
      lineCluster.get(lastY)!.push(annotation);
    } else {
      lineCluster.set(lineY, [annotation]);
    }
  });

  let canvasWidth = 80;

  // calculate canvas width based on the longest line
  if (lineCluster.size > 0) {
    const longestLine = Array.from(lineCluster.values()).reduce((a, b) => {
      const aLength = a.reduce((sum, token) => sum + token.text.length + 1, 0);
      const bLength = b.reduce((sum, token) => sum + token.text.length + 1, 0);
      return aLength > bLength ? a : b;
    });

    const maxSumTextLengths = longestLine.reduce(
      (sum, token) => sum + token.text.length + 1,
      0
    );
    canvasWidth = Math.ceil(maxSumTextLengths * 1.5);
  }
  
  let canvas: string[][] = [];
  for (let i = 0; i < lineCluster.size; i++) {
    canvas.push(new Array(canvasWidth).fill(" "));
  }

  const letterHeight = 30;
  const emptySpaceHeight = letterHeight + 5;
  let maxPreviousLineHeight = emptySpaceHeight;

  const adjustCanvasWidth = (newWidth: number) => {
    if (newWidth > canvasWidth) {
      canvasWidth = newWidth;
      canvas = canvas.map((row) => {
        return [...row, ...new Array(newWidth - row.length).fill(" ")];
      });
    }
  };

  // place the annotations on the canvas
  let i = 0;
  const sortedLineEntries = Array.from(lineCluster.entries()).sort(
    (a, b) => a[0] - b[0]
  );

  for (const [_, lineAnnotations] of sortedLineEntries) {
    // sort annotations in this line by X-coordinate
    lineAnnotations.sort((a, b) => a.midpoint.x - b.midpoint.x);
    const groupedLineAnnotations = groupWordsInSentence(lineAnnotations);

    // use the TOP height of the letter
    const maxLineHeight = Math.max(
      ...groupedLineAnnotations.map(
        (annotation) => annotation.midpoint.y - annotation.height
      )
    );
    const heightToAdd = Math.floor(
      (maxLineHeight - maxPreviousLineHeight) / emptySpaceHeight
    );
    if (heightToAdd > 0) {
      for (let h = 0; h < heightToAdd; h++) {
        canvas.push(new Array(canvasWidth).fill(" "));
        i += 1;
      }
    }

    // store the BOTTOM height of the letter
    maxPreviousLineHeight = Math.max(
      ...groupedLineAnnotations.map((annotation) => annotation.midpoint.y)
    );

    let lastX = 0;
    for (const annotation of groupedLineAnnotations) {
      let text = annotation.text;

      let x = Math.floor(annotation.midpoint_normalized.x * canvasWidth);

      // move forward if there's an overlap
      x = Math.max(x, lastX);

      // ensure the text fits within the canvas
      if (x + text.length >= canvasWidth) {
        adjustCanvasWidth(x + text.length + 1);
      }
      
      for (let j = 0; j < text.length; j++) {
        canvas[i][x + j] = text[j];
      }

      lastX = x + text.length + 1;
    }

    i += 1;
  }

  // delete all whitespace characters after the last non-whitespace character in each row
  canvas = canvas.map((row) => {
    const lineStr = row.join("");
    return Array.from(lineStr.trimEnd());
  });
  
  let pageText = canvas.map((line) => line.join("")).join("\n");
  pageText = pageText.trim();

  pageText = "-".repeat(canvasWidth) + "\n" + pageText + "\n" + "-".repeat(canvasWidth);

  return pageText;
}

function groupWordsInSentence(
  lineAnnotations: TextAnnotation[]
): TextAnnotation[] {
  const groupedAnnotations: TextAnnotation[] = [];
  let currentGroup: TextAnnotation[] = [];

  for (const annotation of lineAnnotations) {
    if (currentGroup.length === 0) {
      currentGroup.push(annotation);
      continue;
    }

    const padding = 2;
    const characterWidth =
      (currentGroup[currentGroup.length - 1].width /
        currentGroup[currentGroup.length - 1].text.length) *
      padding;
    const isSingleCharacterAway =
      annotation.midpoint.x <=
      currentGroup[currentGroup.length - 1].midpoint.x +
      currentGroup[currentGroup.length - 1].width +
      characterWidth;

    if (
      Math.abs(annotation.height - currentGroup[0].height) <= 4 &&
      isSingleCharacterAway
    ) {
      currentGroup.push(annotation);
    } else {
      if (currentGroup.length > 0) {
        const groupedAnnotation = createGroupedAnnotation(currentGroup);
        groupedAnnotations.push(groupedAnnotation);
        currentGroup = [annotation];
      }
    }
  }

  // append the last group if it exists
  if (currentGroup.length > 0) {
    const groupedAnnotation = createGroupedAnnotation(currentGroup);
    groupedAnnotations.push(groupedAnnotation);
  }

  return groupedAnnotations;
}

function createGroupedAnnotation(group: TextAnnotation[]): TextAnnotation {
  // for the text, don't put a space if it is a punctuation mark
  let text = "";

  for (const word of group) {
    if ([".", ",", '"', "'", ":", ";", "!", "?", "{", "}", "’", "”"].includes(word.text)) {
      text += word.text;
    } else {
      text += text !== "" ? " " + word.text : word.text;
    }
  }

  // test that the 'word' is longer than 1 character and contains alphanumeric characters
  const isWord = /[a-zA-Z0-9]/.test(text);
  const medianHeight = median(group.map((word) => word.height));
  if (isWord && medianHeight > 25) {
    text = "**" + text + "**";
  }

  return {
    text: text,
    midpoint: {
      x: group[0].midpoint.x,
      y: group[0].midpoint.y,
    },
    midpoint_normalized: {
      x: group[0].midpoint_normalized.x,
      y: group[0].midpoint_normalized.y,
    },
    width: group.reduce((sum, a) => sum + a.width, 0),
    height: group[0].height,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  } else {
    return sorted[middle];
  }
}

export function logLineToString(logLine: LogLine): string {
  const timestamp = logLine.timestamp || new Date().toISOString();
  if (logLine.auxiliary?.error) {
    return `${timestamp}::[stagehand:${logLine.category}] ${logLine.message}\n ${logLine.auxiliary.error.value}\n ${logLine.auxiliary.trace.value}`;
  }
  return `${timestamp}::[stagehand:${logLine.category}] ${logLine.message} ${
    logLine.auxiliary ? JSON.stringify(logLine.auxiliary) : ""
  }`;
}
