/**
 * decision Go renderer（net/http 原始请求）。
 */
import { ENV_KEY_EXPR } from '../../config/placeholders.js';
import { goRawSafe } from '../../emit/escape.js';
import { jsonLines } from '../../emit/literal.js';
import { decisionNote } from './shared.js';
import type { DecisionCtx } from '../../wire/decision.js';

export function decisionGo(ctx: DecisionCtx): string {
  const bodyStr = jsonLines(ctx.bodyObj, '\t\t');
  return `package main

import (
\t"bytes"
\t"fmt"
\t"io"
\t"net/http"
\t"os"
)

func main() {
${decisionNote('//', '\t')}
\tpayload := []byte(\`
${goRawSafe(bodyStr)}
\t\`)
\treq, _ := http.NewRequest("POST", "${ctx.baseUrl}${ctx.path}", bytes.NewBuffer(payload))
\treq.Header.Set("Content-Type", "application/json")
\treq.Header.Set("Authorization", "Bearer " + ${ENV_KEY_EXPR.go})

\tresp, err := http.DefaultClient.Do(req)
\tif err != nil {
\t\tpanic(err)
\t}
\tdefer resp.Body.Close()
\tout, _ := io.ReadAll(resp.Body)
\tfmt.Println(string(out))
}`;
}
