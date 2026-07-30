/**
 * 媒体 TypeScript / JavaScript renderer：图（同步单段）/ 视频（提交 + 轮询）。
 */
import { BASE } from '../../config/placeholders.js';
import { VID_PATH_DEFAULT } from '../../config/media.js';
import { blockLines } from '../../emit/literal.js';
import { splitMultipart, type MediaCtx } from '../../wire/media.js';

// ---- 图：TypeScript / JavaScript ----
export function mediaImageTs(ctx: MediaCtx): string {
  const url = `${BASE}${ctx.submitPath}`;
  const tail = `if (!response.ok) throw new Error(\`HTTP \${response.status}\`);
const data = await response.json(); // { id, status: "completed", output: [...], error }

// Each output item has b64_json or content_url.
// content_url downloads need the same Bearer key and expire in ~30 minutes.
for (const item of data.output ?? []) {
  console.log(item.content_url ?? item.b64_json?.slice(0, 80));
}`;

  if (ctx.encoding === 'multipart') {
    const { data, files } = splitMultipart(ctx);
    const dataLines = data.map((d) => `form.append(${JSON.stringify(d.key)}, ${JSON.stringify(d.value)});`).join('\n');
    const fileLines = files
      .map((k) => `// form.append(${JSON.stringify(k)}, ${k}File, "${k}.png");  // Blob/File from an <input> or fs`)
      .join('\n');
    return `// Image edit (multipart/form-data): POST ${ctx.submitPath} — binary source image upload
const form = new FormData();
${dataLines}
${fileLines}

const response = await fetch("${url}", {
  method: "POST",
  headers: { "Authorization": "Bearer " + process.env.AIHUBMIX_API_KEY }, // no Content-Type: the browser sets the boundary
  body: form,
});

${tail}`;
  }

  const bodyStr = blockLines(ctx.bodyObj, '  ');
  return `// Text-to-image (sync): POST ${ctx.submitPath} — blocks until done, returns a task object
const response = await fetch("${url}", {
  method: "POST",
  headers: {
    "Authorization": "Bearer " + process.env.AIHUBMIX_API_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(${bodyStr}),
});

${tail}`;
}

// ---- 视频：TypeScript / JavaScript（提交 + 轮询） ----
export function mediaVideoTs(ctx: MediaCtx): string {
  const bodyStr = blockLines(ctx.bodyObj, '    ');
  const pollPath = (ctx.pollPath || `${VID_PATH_DEFAULT}/{id}`).replace(/\{(id|video_id|task_id)\}/g, '${videoId}');
  return `// Text-to-video (async): submit a job, then poll until it finishes
const BASE = "${BASE}";
const headers = {
  Authorization: "Bearer " + process.env.AIHUBMIX_API_KEY,
  "Content-Type": "application/json",
};

// Step 1: submit the video generation job (returns immediately with status "pending")
const submitRes = await fetch(\`\${BASE}${ctx.submitPath}\`, {
  method: "POST",
  headers,
  body: JSON.stringify(${bodyStr}),
});
if (!submitRes.ok) throw new Error(\`HTTP \${submitRes.status}\`);
const { id: videoId } = await submitRes.json();
console.log("Job submitted, videoId:", videoId);

// Step 2: poll the job status until a terminal state (completed / failed / cancelled)
while (true) {
  await new Promise((r) => setTimeout(r, 5000));
  const pollRes = await fetch(\`\${BASE}${pollPath}\`, {
    headers: { Authorization: headers.Authorization },
  });
  if (!pollRes.ok) throw new Error(\`poll HTTP \${pollRes.status}\`);
  const result = await pollRes.json(); // task object: { id, status, output: [...], error }
  console.log("Status:", result.status);
  if (result.status === "completed") {
    // Step 3: download output[].content_url (Bearer required; expires in ~30 minutes)
    console.log("Done, download with Bearer:", result.output?.[0]?.content_url);
    break;
  }
  if (result.status === "failed" || result.status === "cancelled") {
    console.error("Job ended:", result.status, result.error);
    break;
  }
}`;
}
