import OpenAI, { ClientOptions } from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import {
  ChatCompletion,
  ChatCompletionContentPartImage,
  ChatCompletionContentPartText,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from "openai/resources/chat";
import { LogLine } from "../../types/log";
import { AvailableModel } from "../../types/model";
import { LLMCache } from "../cache/LLMCache";
import { ChatCompletionOptions, ChatMessage, LLMClient } from "./LLMClient";

export class OpenAIClient extends LLMClient {
  private client: OpenAI;
  private cache: LLMCache | undefined;
  public logger: (message: LogLine) => void;
  private enableCaching: boolean;
  private clientOptions: ClientOptions;

  constructor(
    logger: (message: LogLine) => void,
    enableCaching = false,
    cache: LLMCache | undefined,
    modelName: AvailableModel,
    clientOptions?: ClientOptions,
  ) {
    super(modelName);
    this.client = new OpenAI(clientOptions);
    this.logger = logger;
    this.cache = cache;
    this.enableCaching = enableCaching;
    this.modelName = modelName;
  }

  async createChatCompletion(
    options: ChatCompletionOptions,
  ): Promise<ChatCompletion> {
    const optionsWithoutImage = { ...options };
    delete optionsWithoutImage.image;
    this.logger({
      category: "openai",
      message: "creating chat completion",
      level: 1,
      auxiliary: {
        options: {
          value: JSON.stringify(optionsWithoutImage),
          type: "object",
        },
        modelName: {
          value: this.modelName,
          type: "string",
        },
      },
    });
    const cacheOptions = {
      model: this.modelName,
      messages: options.messages,
      temperature: options.temperature,
      top_p: options.top_p,
      frequency_penalty: options.frequency_penalty,
      presence_penalty: options.presence_penalty,
      image: options.image,
      response_model: options.response_model,
    };

    if (this.enableCaching) {
      const cachedResponse = await this.cache.get(
        cacheOptions,
        options.requestId,
      );

      if (cachedResponse) {
        this.logger({
          category: "llm_cache",
          message: "LLM cache hit - returning cached response",
          level: 1,
          auxiliary: {
            requestId: {
              value: options.requestId,
              type: "string",
            },
            cachedResponse: {
              value: JSON.stringify(cachedResponse),
              type: "object",
            },
          },
        });
        return cachedResponse;
      } else {
        this.logger({
          category: "llm_cache",
          message: "LLM cache miss - no cached response found",
          level: 1,
          auxiliary: {
            requestId: {
              value: options.requestId,
              type: "string",
            },
          },
        });
      }
    }

    if (options.image) {
      const screenshotMessage: ChatMessage = {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${options.image.buffer.toString("base64")}`,
            },
          },
          ...(options.image.description
            ? [{ type: "text", text: options.image.description }]
            : []),
        ],
      };

      options.messages.push(screenshotMessage);
    }

    const { response_model, ...openAiOptions } = {
      ...options,
      model: this.modelName,
    };

    let responseFormat = undefined;
    if (options.response_model) {
      responseFormat = zodResponseFormat(
        options.response_model.schema,
        options.response_model.name,
      );
    }

    this.logger({
      category: "openai",
      message: "creating chat completion",
      level: 1,
      auxiliary: {
        openAiOptions: {
          value: JSON.stringify(openAiOptions),
          type: "object",
        },
      },
    });

    delete openAiOptions.requestId;

    const formattedMessages: ChatCompletionMessageParam[] =
      options.messages.map((message) => {
        if (Array.isArray(message.content)) {
          const contentParts = message.content.map((content) => {
            if ("image_url" in content) {
              return {
                image_url: {
                  url: content.image_url.url,
                },
                type: "image_url",
              } as ChatCompletionContentPartImage;
            } else {
              return {
                text: content.text,
                type: "text",
              } as ChatCompletionContentPartText;
            }
          });

          return {
            ...message,
            content: contentParts,
          } as ChatCompletionMessageParam;
        }

        return message as ChatCompletionMessageParam;
      });

    const body: ChatCompletionCreateParamsNonStreaming = {
      ...openAiOptions,
      model: this.modelName,
      messages: formattedMessages,
      response_format: responseFormat,
      stream: false,
      tools: options.tools?.filter((tool) => "function" in tool), // ensure only OpenAI tools are used
    };

    const response = await this.client.chat.completions.create(body);

    this.logger({
      category: "openai",
      message: "response",
      level: 1,
      auxiliary: {
        response: {
          value: JSON.stringify(response),
          type: "object",
        },
        requestId: {
          value: options.requestId,
          type: "string",
        },
      },
    });

    if (response_model) {
      const extractedData = response.choices[0].message.content;
      const parsedData = JSON.parse(extractedData);

      if (this.enableCaching) {
        this.cache.set(
          cacheOptions,
          {
            ...parsedData,
          },
          options.requestId,
        );
      }

      return {
        ...parsedData,
      };
    }

    if (this.enableCaching) {
      this.logger({
        category: "llm_cache",
        message: "caching response",
        level: 1,
        auxiliary: {
          requestId: {
            value: options.requestId,
            type: "string",
          },
          cacheOptions: {
            value: JSON.stringify(cacheOptions),
            type: "object",
          },
          response: {
            value: JSON.stringify(response),
            type: "object",
          },
        },
      });
      this.cache.set(cacheOptions, response, options.requestId);
    }

    return response;
  }
}
