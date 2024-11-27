import Anthropic, { ClientOptions } from "@anthropic-ai/sdk";
import { MessageParam, TextBlockParam } from "@anthropic-ai/sdk/resources";
import { zodToJsonSchema } from "zod-to-json-schema";
import { LogLine } from "../../types/log";
import { AvailableModel } from "../../types/model";
import { LLMCache } from "../cache/LLMCache";
import { ChatCompletionOptions, LLMClient } from "./LLMClient";

export class AnthropicClient extends LLMClient {
  private client: Anthropic;
  private cache: LLMCache | undefined;
  public logger: (message: LogLine) => void;
  private enableCaching: boolean;

  constructor(
    logger: (message: LogLine) => void,
    enableCaching = false,
    cache: LLMCache | undefined,
    modelName: AvailableModel,
    clientOptions?: ClientOptions,
  ) {
    super(modelName);
    this.client = new Anthropic(clientOptions);
    this.logger = logger;
    this.cache = cache;
    this.enableCaching = enableCaching;
    this.modelName = modelName;
  }

  async createChatCompletion(
    options: ChatCompletionOptions & { retries?: number },
  ): Promise<any> {
    // TODO (kamath): remove this forced typecast
    const { image: _, ...optionsWithoutImage } = options;
    this.logger({
      category: "anthropic",
      message: "creating chat completion",
      level: 1,
      auxiliary: {
        options: {
          value: JSON.stringify(optionsWithoutImage),
          type: "object",
        },
      },
    });
    // Try to get cached response
    const cacheOptions = {
      model: this.modelName,
      messages: options.messages,
      temperature: options.temperature,
      image: options.image,
      response_model: options.response_model,
      tools: options.tools,
      retries: options.retries,
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
            cachedResponse: {
              value: JSON.stringify(cachedResponse),
              type: "object",
            },
            requestId: {
              value: options.requestId,
              type: "string",
            },
            cacheOptions: {
              value: JSON.stringify(cacheOptions),
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
            cacheOptions: {
              value: JSON.stringify(cacheOptions),
              type: "object",
            },
            requestId: {
              value: options.requestId,
              type: "string",
            },
          },
        });
      }
    }

    // system message doesn't support image content, so filter it out
    const systemMessage = options.messages.find(
      (msg) =>
        msg.role === "system" &&
        (typeof msg.content === "string" ||
          (Array.isArray(msg.content) &&
            msg.content.every((content) => content.type !== "image_url"))),
    );
    const userMessages = options.messages.filter(
      (msg) => msg.role !== "system",
    );

    const formattedMessages: MessageParam[] = userMessages.map((msg) => {
      if (typeof msg.content === "string") {
        return {
          role: msg.role as "user" | "assistant", // ensure its not checking for system types
          content: msg.content,
        };
      } else {
        return {
          role: msg.role as "user" | "assistant",
          content: msg.content.map((content) => {
            if (content.type === "text") {
              return { type: "text", text: content.text };
            }

            // don't handle image content for now
          }),
        };
      }
    });

    if (options.image) {
      const screenshotMessage: MessageParam = {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: options.image.buffer.toString("base64"),
            },
          },
        ],
      };

      if (
        options.image.description &&
        Array.isArray(screenshotMessage.content)
      ) {
        screenshotMessage.content.push({
          type: "text",
          text: options.image.description,
        });
      }

      formattedMessages.push(screenshotMessage);
    }

    // Transform tools to Anthropic's format
    let anthropicTools = options.tools?.map((tool: any) => {
      if (tool.type === "function") {
        return {
          name: tool.function.name,
          description: tool.function.description,
          input_schema: {
            type: "object",
            properties: tool.function.parameters.properties,
            required: tool.function.parameters.required,
          },
        };
      }
      return tool;
    });

    let toolDefinition;
    if (options.response_model) {
      const jsonSchema = zodToJsonSchema(options.response_model.schema);
      // Extract the actual schema properties
      // TODO (kamath): fix this forced typecast
      const schemaProperties =
        (
          jsonSchema.definitions?.MySchema as {
            properties?: Record<string, any>;
          }
        )?.properties ||
        (jsonSchema as { properties?: Record<string, any> }).properties;
      const schemaRequired =
        (jsonSchema.definitions?.MySchema as { required?: string[] })
          ?.required || (jsonSchema as { required?: string[] }).required;

      toolDefinition = {
        name: "print_extracted_data",
        description: "Prints the extracted data based on the provided schema.",
        input_schema: {
          type: "object",
          properties: schemaProperties,
          required: schemaRequired,
        },
      };
    }

    if (toolDefinition) {
      anthropicTools = anthropicTools ?? [];
      anthropicTools.push(toolDefinition);
    }

    const response = await this.client.messages.create({
      model: this.modelName,
      max_tokens: options.maxTokens || 1500,
      messages: formattedMessages,
      tools: anthropicTools,
      system: systemMessage
        ? (systemMessage.content as string | TextBlockParam[]) // we can cast because we already filtered out image content
        : undefined,
      temperature: options.temperature,
    });

    this.logger({
      category: "anthropic",
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

    // Parse the response here
    const transformedResponse = {
      id: response.id,
      object: "chat.completion",
      created: Date.now(),
      model: response.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content:
              response.content.find((c) => c.type === "text")?.text || null,
            tool_calls: response.content
              .filter((c) => c.type === "tool_use")
              .map((toolUse: any) => ({
                id: toolUse.id,
                type: "function",
                function: {
                  name: toolUse.name,
                  arguments: JSON.stringify(toolUse.input),
                },
              })),
          },
          finish_reason: response.stop_reason,
        },
      ],
      usage: {
        prompt_tokens: response.usage.input_tokens,
        completion_tokens: response.usage.output_tokens,
        total_tokens:
          response.usage.input_tokens + response.usage.output_tokens,
      },
    };

    this.logger({
      category: "anthropic",
      message: "transformed response",
      level: 1,
      auxiliary: {
        transformedResponse: {
          value: JSON.stringify(transformedResponse),
          type: "object",
        },
        requestId: {
          value: options.requestId,
          type: "string",
        },
      },
    });

    if (options.response_model) {
      const toolUse = response.content.find((c) => c.type === "tool_use");
      if (toolUse && "input" in toolUse) {
        const result = toolUse.input;
        if (this.enableCaching) {
          this.cache.set(cacheOptions, result, options.requestId);
        }

        return result;
      } else {
        if (!options.retries || options.retries < 5) {
          return this.createChatCompletion({
            ...options,
            retries: (options.retries ?? 0) + 1,
          });
        }
        this.logger({
          category: "anthropic",
          message: "error creating chat completion",
          level: 1,
          auxiliary: {
            requestId: {
              value: options.requestId,
              type: "string",
            },
          },
        });
        throw new Error(
          "Create Chat Completion Failed: No tool use with input in response",
        );
      }
    }

    if (this.enableCaching) {
      this.cache.set(cacheOptions, transformedResponse, options.requestId);
      this.logger({
        category: "anthropic",
        message: "cached response",
        level: 1,
        auxiliary: {
          requestId: {
            value: options.requestId,
            type: "string",
          },
          transformedResponse: {
            value: JSON.stringify(transformedResponse),
            type: "object",
          },
          cacheOptions: {
            value: JSON.stringify(cacheOptions),
            type: "object",
          },
        },
      });
    }

    return transformedResponse;
  }
}
