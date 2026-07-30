/**
 * 媒体 cURL renderer：图（同步单段 / multipart）/ 视频（提交 + 轮询 + 下载三段）。
 */
import { API_KEY_PLACEHOLDER } from '../../config/placeholders.js';
import { VID_PATH_DEFAULT } from '../../config/media.js';
import { shellSafe } from '../../emit/escape.js';
import { jsonLines } from '../../emit/literal.js';
import { splitMultipart, type MediaCtx } from '../../wire/media.js';

// ---- 图：curl ----
export function mediaImageCurl(ctx: MediaCtx): string {
  const url = `${ctx.baseUrl}${ctx.submitPath}`;
  const download = `
# Download a content_url (same Bearer key required; expires in ~30 minutes):
# curl -H "Authorization: Bearer $${API_KEY_PLACEHOLDER}" -o image.png "<content_url>"`;

  if (ctx.encoding === 'multipart') {
    const { data, files } = splitMultipart(ctx);
    const dataFlags = data.map((d) => `  -F ${shellSafe(`${d.key}=${d.value}`)} \\`).join('\n');
    const fileFlags = files.map((k) => `  -F "${k}=@${k}.png" \\`).join('\n');
    return `# Image edit (multipart/form-data): POST ${ctx.submitPath} — binary source image upload
curl ${url} \\
  -H "Authorization: Bearer $${API_KEY_PLACEHOLDER}" \\
${dataFlags}
${fileFlags.replace(/\\\n?$/, '')}
${download.trim()}`;
  }

  const bodyStr = jsonLines(ctx.bodyObj, '  ').trim();
  return `# Text-to-image (sync): POST ${ctx.submitPath} — blocks until done, returns a task object
# Results are in output[]; each item has b64_json or content_url.
curl ${url} \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $${API_KEY_PLACEHOLDER}" \\
  -d '${shellSafe(bodyStr)}'
${download}`;
}

// ---- 视频：curl（提交 + 轮询两段） ----
export function mediaVideoCurl(ctx: MediaCtx): string {
  const bodyStr = jsonLines(ctx.bodyObj, '  ').trim();
  const pollPath = (ctx.pollPath || `${VID_PATH_DEFAULT}/{id}`).replace(/\{(id|video_id|task_id)\}/g, '<video_id>');
  return `# Text-to-video (async): Step 1 submit the job, Step 2 poll, Step 3 download

# Step 1: submit the video job (returns { "id": "<video_id>", "status": "pending", ... })
curl ${ctx.baseUrl}${ctx.submitPath} \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $${API_KEY_PLACEHOLDER}" \\
  -d '${shellSafe(bodyStr)}'

# Step 2: poll the job status (replace <video_id> with the id from step 1)
# status: pending → in_progress → completed | failed | cancelled
# when completed, the result is in output[0].content_url
curl ${ctx.baseUrl}${pollPath} \\
  -H "Authorization: Bearer $${API_KEY_PLACEHOLDER}"

# Step 3: download the artifact (same Bearer key required; expires in ~30 minutes)
curl -H "Authorization: Bearer $${API_KEY_PLACEHOLDER}" -o video.mp4 "<content_url>"`;
}
