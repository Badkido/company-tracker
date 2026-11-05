# inbox

外部 agent 把新闻/业绩会要点以 `YYYY-MM-DD.json`（JSON 数组）放进这里并开 PR。
合并到 main 后，`ingest` 工作流会校验并写入 `data/pdd/log.json`，处理过的文件移到 `processed/`。
字段：`kind`(view|event|temu|team|qa)、`date`、`title`、`detail`、`source`（URL，必填）；qa 另需 `quarter`（如 26Q3）。

多公司：每条加 `"company": "pdd"`（默认）或 `"tencent"`。腾讯的 kind 为 `event|view|team|qa|holder`，另有 `ai_log`（给 AI 产品追加动态，字段见 `AGENT_PROMPT_tencent.md`）。腾讯 agent 提示词见 [AGENT_PROMPT_tencent.md](AGENT_PROMPT_tencent.md)。

agent 的 PR 由 Claude（定时任务 `review-inbox-prs`）核对来源后，触发 `automerge` 工作流校验、合并、写入并部署；不合格的条目会被删除，整个 PR 都不合格则关闭并留言。
