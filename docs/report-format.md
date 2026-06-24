# 报告 JSON 格式

报告用于 UI 展示、失败重试和人工审计。它不包含密码、Cookie、二步验证 token。

## Schema

```ts
type RunReport = {
  schemaVersion: "vrc-blocker.report.v1";
  runId: string;
  manifestName?: string;
  account?: {
    accountId?: string;
    userId?: string;
    displayName?: string;
    sessionState: "unknown" | "valid" | "requiresTwoFactor" | "invalid";
    lastValidatedAt?: string;
  };
  startedAt: string;
  finishedAt?: string;
  summary: {
    total: number;
    success: number;
    failed: number;
    skipped: number;
    alreadyBlocked: number;
  };
  items: RunItemResult[];
};

type RunItemResult = {
  rowIndex: number;
  uid: string;
  memo: string;
  status:
    | "success"
    | "failed"
    | "skipped"
    | "already_blocked"
    | "failed_block_after_note"
    | "failed_note_after_block";
  note?: OperationResult;
  block?: OperationResult;
  attempts: number;
  error?: string;
};

type OperationResult = {
  action: string;
  verified: boolean;
  httpStatus?: number;
  message?: string;
};
```

## Example

```json
{
  "schemaVersion": "vrc-blocker.report.v1",
  "runId": "b9ce1819-e982-46db-a7c8-70f3f56ef8e0",
  "manifestName": "example.csv",
  "account": {
    "accountId": "usr_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "userId": "usr_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "displayName": "example-account",
    "sessionState": "valid",
    "lastValidatedAt": "2026-06-24T12:00:00Z"
  },
  "startedAt": "2026-06-24T12:01:00Z",
  "finishedAt": "2026-06-24T12:02:00Z",
  "summary": {
    "total": 2,
    "success": 1,
    "failed": 0,
    "skipped": 0,
    "alreadyBlocked": 1
  },
  "items": [
    {
      "rowIndex": 2,
      "uid": "usr_00000000-0000-4000-8000-000000000001",
      "memo": "风险等级：高；类别：示例；名称：示例用户A；来源：示例名单；原因：示例原因；备注：演示数据",
      "status": "success",
      "note": {
        "action": "overwritten",
        "verified": true,
        "httpStatus": 200
      },
      "block": {
        "action": "created",
        "verified": true,
        "httpStatus": 200
      },
      "attempts": 1
    },
    {
      "rowIndex": 3,
      "uid": "usr_00000000-0000-4000-8000-000000000002",
      "memo": "风险等级：中；类别：示例；名称：示例用户B；来源：示例名单；原因：示例原因；备注：演示数据",
      "status": "already_blocked",
      "note": {
        "action": "overwritten",
        "verified": true,
        "httpStatus": 200
      },
      "block": {
        "action": "already_blocked",
        "verified": true
      },
      "attempts": 1
    }
  ]
}
```
