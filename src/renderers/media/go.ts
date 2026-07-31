/**
 * 媒体 Go renderer（net/http 原始请求）：图（同步单段）/ 视频（提交 + 轮询）。
 */
import { API_KEY_PLACEHOLDER } from '../../config/placeholders.js';
import { VID_PATH_DEFAULT } from '../../config/media.js';
import { goRawSafe } from '../../emit/escape.js';
import { jsonLines } from '../../emit/literal.js';
import { mpNote, type MediaCtx } from '../../wire/media.js';

// ---- 图：Go（net/http 原始请求） ----
export function mediaImageGo(ctx: MediaCtx): string {
  const bodyStr = jsonLines(ctx.bodyObj, '\t\t');
  const note = mpNote(ctx, '\t');
  return `package main

import (
\t"bytes"
\t"fmt"
\t"io"
\t"net/http"
)

func main() {
${note}\t// Synchronous image generation: POST ${ctx.submitPath} (blocking; returns the unified task
\t// object, results in output[] — each item carries b64_json or content_url. Downloading a
\t// content_url needs the same Bearer token and the link expires in about 30 minutes.)
\tpayload := []byte(\`
${goRawSafe(bodyStr)}
\t\`)
\treq, _ := http.NewRequest("POST", "${ctx.baseUrl}${ctx.submitPath}", bytes.NewBuffer(payload))
\treq.Header.Set("Content-Type", "application/json")
\treq.Header.Set("Authorization", "Bearer ${API_KEY_PLACEHOLDER}")

\tresp, err := http.DefaultClient.Do(req)
\tif err != nil {
\t\tpanic(err)
\t}
\tdefer resp.Body.Close()
\tout, _ := io.ReadAll(resp.Body)
\tfmt.Println(string(out))
}`;
}

// ---- 视频：Go（net/http 原始请求，提交 + 轮询） ----
export function mediaVideoGo(ctx: MediaCtx): string {
  const bodyStr = jsonLines(ctx.bodyObj, '\t\t');
  const pollPath = (ctx.pollPath || `${VID_PATH_DEFAULT}/{id}`).replace(/\{(id|video_id|task_id)\}/g, '"+submit.ID+"');
  return `package main

import (
\t"bytes"
\t"encoding/json"
\t"fmt"
\t"io"
\t"net/http"
\t"time"
)

func main() {
\t// Async video generation: Step 1 submit, Step 2 poll
\tbase := "${ctx.baseUrl}"
\tapiKey := "${API_KEY_PLACEHOLDER}"

\t// Step 1: submit the generation task
\tpayload := []byte(\`
${goRawSafe(bodyStr)}
\t\`)
\treq, _ := http.NewRequest("POST", base+"${ctx.submitPath}", bytes.NewBuffer(payload))
\treq.Header.Set("Content-Type", "application/json")
\treq.Header.Set("Authorization", "Bearer "+apiKey)

\tresp, err := http.DefaultClient.Do(req)
\tif err != nil {
\t\tpanic(err)
\t}
\tdefer resp.Body.Close()

\tvar submit struct{ ID string \`json:"id"\` }
\tjson.NewDecoder(resp.Body).Decode(&submit)
\tfmt.Println("Submitted, videoId:", submit.ID)

\t// Step 2: poll until a terminal status (completed / failed / cancelled)
\tfor {
\t\ttime.Sleep(5 * time.Second)
\t\tpollReq, _ := http.NewRequest("GET", base+"${pollPath}", nil)
\t\tpollReq.Header.Set("Authorization", "Bearer "+apiKey)
\t\tpollResp, _ := http.DefaultClient.Do(pollReq)
\t\tbody, _ := io.ReadAll(pollResp.Body)
\t\tpollResp.Body.Close()

\t\tvar result map[string]interface{}
\t\tjson.Unmarshal(body, &result)
\t\tstatus, _ := result["status"].(string)
\t\tfmt.Println("status:", status)
\t\tif status == "completed" {
\t\t\t// Result is in output[0].content_url — downloading needs the same Bearer (expires in ~30 min)
\t\t\tif outs, ok := result["output"].([]interface{}); ok && len(outs) > 0 {
\t\t\t\tif item, ok := outs[0].(map[string]interface{}); ok {
\t\t\t\t\tfmt.Println("Done. Download URL (send the same Bearer):", item["content_url"])
\t\t\t\t}
\t\t\t}
\t\t\tbreak
\t\t}
\t\tif status == "failed" || status == "cancelled" {
\t\t\tfmt.Println("Task ended:", status, result["error"])
\t\t\tbreak
\t\t}
\t}
}`;
}
