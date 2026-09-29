# Autonomous AI Runner · 全自动模型测试

在线入口：

**https://sstxww.github.io/blackgate-ai-game/autoplay.html**

这是 Blackgate 推荐的 AI 测试方式。

## 使用流程

1. 填写你的中转站 API URL。
2. 填写 API Key。
3. 点击 **获取模型**。
4. 从中转站实时返回的模型列表中选择模型。
5. 选择推理等级。
6. 输入用户名 / 昵称。
7. 修改或保留默认规则提示词。
8. 点击 **开始 AI 自主测试**。
9. AI 会自动连续处理案件、读取日结、进入下一天，直到本局结束。
10. 完成后查看日志、赛后报告和排行榜。

不需要 Codex，不需要手动复制每一回合，也不需要逐个点击动作。

---

## 中转接口要求

推荐使用 **OpenAI-Compatible** 接口。

典型 Base URL：

```text
https://your-relay.example.com/v1
```

页面会自动使用：

```text
GET  /models
POST /chat/completions
```

如果选择 Responses API，则调用：

```text
POST /responses
```

也可以直接把以下任意形式粘进 API URL 输入框，页面会自动归一化：

```text
https://relay.example.com/v1
https://relay.example.com/v1/models
https://relay.example.com/v1/chat/completions
https://relay.example.com/v1/responses
```

---

## 支持哪些模型？

Blackgate 不维护一张固定模型白名单。

模型列表直接来自你自己的中转站 `/models`，所以：

> **中转站返回什么模型，页面就能选择什么模型。**

因此可以接入由兼容中转站提供的：

- OpenAI GPT / reasoning models
- Anthropic Claude
- Google Gemini
- xAI Grok
- DeepSeek
- 阿里 Qwen
- 智谱 GLM
- Moonshot / Kimi
- MiniMax
- 火山方舟 / 豆包
- 腾讯混元
- Mistral
- 以及其他国产 / 海外模型

如果某个接口没有 `/models`，可以手动填写模型名。

---

## 推理等级

可选：

```text
Auto
Low
Medium
High
Extra High / xhigh
```

Chat Completions 模式会尝试发送：

```json
{"reasoning_effort":"high"}
```

Responses 模式会尝试发送：

```json
{"reasoning":{"effort":"high"}}
```

不同中转站对推理参数的实现并不统一。

如果接口明确拒绝 reasoning 参数，Blackgate 会自动去掉该字段重试，并在日志中记录一次兼容性降级；你选择的推理等级仍会写入 System Prompt。

---

## API Key 隐私

**本项目不保存 API Key。**

API Key 不会被写入：

- localStorage
- IndexedDB
- Cookie
- 运行日志
- JSON 日志导出
- 排行榜
- GitHub

Key 只存在于当前页面内存以及浏览器直接发往你填写 API URL 的请求头中。

关闭页面后，页面内存里的 Key 会消失。也可以随时点击 **清除**。

Blackgate GitHub Pages 没有自建 API 代理服务器，不会替你转存 Key。

---

## CORS

GitHub Pages 是纯静态网页。

如果你的中转站不允许浏览器跨域请求，浏览器会拦截请求，Blackgate 无法从网页端绕过。

这种情况下可以：

- 换一个支持 CORS 的中转站；
- 或使用仓库本地 Runner。

---

## 自动日志

每一步会记录：

- 时间
- Day / Case
- 模型名
- 动作
- 简短理由
- confidence
- 请求延迟
- Token 用量
- Chat / Responses 协议
- 接口错误
- 自动重试
- 推理参数兼容性降级

日志不会保存 API Key。

完成后可以导出 JSON。

---

## 自定义提示词

用户可以完整修改规则提示词。

Blackgate 只会自动追加一个动作输出协议：

```json
{
  "action": "allow|reject|search|isolate|next_day",
  "reason": "不超过两句话",
  "confidence": 85
}
```

这样页面才能自动解析并执行 AI 的动作。

项目不会要求模型输出详细思维链。

---

## 排行榜

用户名会跟随本局记录保存。

本机榜会自动显示本机完成的运行。

公开社区榜仍通过赛后报告提交到 GitHub，当前属于 **self-reported** 数据；未来固定种子验证榜会单独标记。

---

## 公平测试建议

严肃比较模型时建议统一：

- 游戏版本
- 难度
- 随机种子
- 模型版本
- 中转站
- 推理等级
- System Prompt
- 上下文策略
- 最大重试次数

这样才能把差异尽量归因于模型决策能力，而不是测试环境不同。
