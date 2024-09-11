import { type OpenAIListModelResponse } from "@/app/client/platforms/openai";
import { getServerSideConfig } from "@/app/config/server";
import { ModelProvider, OpenaiPath } from "@/app/constant";
import { prettyObject } from "@/app/utils/format";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "./auth";
import { requestOpenai } from "./common";

const ALLOWD_PATH = new Set(Object.values(OpenaiPath));

function getModels(remoteModelRes: OpenAIListModelResponse) {
  const config = getServerSideConfig();

  if (config.disableGPT4) {
    remoteModelRes.data = remoteModelRes.data.filter(
      (m) =>
        !(m.id.startsWith("gpt-4") || m.id.startsWith("chatgpt-4o")) ||
        m.id.startsWith("gpt-4o-mini"),
    );
  }

  return remoteModelRes;
}
async function getTokenCount(messages: any, model: string) {
  try {
    // 将 messages 数组序列化为 JSON 字符串
    const messagesString = JSON.stringify(messages);

    const tokenRes = await fetch(
      `https://ticktoken-counter.vercel.app/?model=${model}&message=${encodeURIComponent(messagesString)}`,
      { method: "POST" }
    );
    const data = await tokenRes.json();
    return data.token_count;
  } catch (error) {
    console.error("Error fetching token count:", error);
    return null;
  }
}

export async function handle(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  console.log("[OpenAI Route] params ", params);

  if (req.method === "OPTIONS") {
    return NextResponse.json({ body: "OK" }, { status: 200 });
  }

  const subpath = params.path.join("/");

  if (!ALLOWD_PATH.has(subpath)) {
    console.log("[OpenAI Route] forbidden path ", subpath);
    return NextResponse.json(
      {
        error: true,
        msg: "you are not allowed to request " + subpath,
      },
      {
        status: 403,
      },
    );
  }

  const authResult = auth(req, ModelProvider.GPT);
  if (authResult.error) {
    return NextResponse.json(authResult, {
      status: 401,
    });
  }

  try {
    const requestBody = await req.json();
    const messages = requestBody?.messages || []; // 获取 messages 数组
    const model = requestBody?.model || "gpt-3.5-turbo"; // 从请求中获取模型，默认是 gpt-3.5-turbo

    // 并行发起两个请求：Token 计数服务和 OpenAI 请求
    const [tokenCount, openaiResponse] = await Promise.all([
      getTokenCount(messages, model), // 请求Token计数
      requestOpenai(req), // 请求OpenAI
    ]);

    // 返回响应，并附加自定义头
    const openaiResponseBody = await openaiResponse.json();
    return NextResponse.json(openaiResponseBody, {
      status: openaiResponse.status,
      headers: {
        "X-Token-Count": tokenCount?.toString() || "unknown", // 将token计数放入自定义头
      },
    });
  } catch (e) {
    console.error("[OpenAI] ", e);
    return NextResponse.json(prettyObject(e));
  }
}