/**
 * 媒体 Python renderer：图（同步单段）/ 视频（提交 + 轮询）。
 */
import { API_KEY_PLACEHOLDER, BASE } from '../../config/placeholders.js';
import { VID_PATH_DEFAULT } from '../../config/media.js';
import { pyLiteral } from '../../emit/literal.js';
import { splitMultipart, type MediaCtx } from '../../wire/media.js';

// ---- 图：Python ----
export function mediaImagePy(ctx: MediaCtx): string {
  const url = `${BASE}${ctx.submitPath}`;
  const tail = `
data = response.json()  # { id, status: "completed", output: [...], error }
# Each output item has b64_json or content_url.
# content_url downloads need the same Bearer key and expire in ~30 minutes.
for item in data.get("output", []):
    if item.get("content_url"):
        img = requests.get(item["content_url"], headers={"Authorization": "Bearer ${API_KEY_PLACEHOLDER}"})
        with open(f"image_{item.get('index', 0)}.png", "wb") as f:
            f.write(img.content)
        print("saved:", f.name)
    elif item.get("b64_json"):
        print("b64:", item["b64_json"][:80])`;

  if (ctx.encoding === 'multipart') {
    const { data, files } = splitMultipart(ctx);
    const dataStr = pyLiteral(Object.fromEntries(data.map((d) => [d.key, d.value])), '    ');
    const filesStr = files.length
      ? files.map((k) => `    "${k}": open("${k}.png", "rb"),`).join('\n')
      : '';
    return `import requests

# Image edit (multipart/form-data): POST ${ctx.submitPath} — binary source image upload
url = "${url}"
headers = {"Authorization": "Bearer ${API_KEY_PLACEHOLDER}"}  # no Content-Type: requests sets the multipart boundary
data = ${dataStr}
files = {
${filesStr}
}

response = requests.post(url, headers=headers, data=data, files=files)
response.raise_for_status()${tail}`;
  }

  const bodyStr = pyLiteral(ctx.bodyObj, '    ');
  return `import requests

# Text-to-image (sync): POST ${ctx.submitPath} — blocks until done, returns a task object
url = "${url}"
headers = {
    "Authorization": "Bearer ${API_KEY_PLACEHOLDER}",
    "Content-Type": "application/json",
}
payload = ${bodyStr}

response = requests.post(url, headers=headers, json=payload)
response.raise_for_status()

data = response.json()  # { id, status: "completed", output: [...], error }
# Each output item has b64_json or content_url.
# content_url downloads need the same Bearer key and expire in ~30 minutes.
for item in data.get("output", []):
    if item.get("content_url"):
        img = requests.get(item["content_url"], headers={"Authorization": headers["Authorization"]})
        with open(f"image_{item.get('index', 0)}.png", "wb") as f:
            f.write(img.content)
        print("saved:", f.name)
    elif item.get("b64_json"):
        print("b64:", item["b64_json"][:80])`;
}

// ---- 视频：Python（提交 + 轮询） ----
export function mediaVideoPy(ctx: MediaCtx): string {
  const bodyStr = pyLiteral(ctx.bodyObj, '    ');
  const pollPath = ctx.pollPath || `${VID_PATH_DEFAULT}/{video_id}`;
  return `import time
import requests

# Text-to-video (async): submit a job, then poll until it finishes
BASE = "${BASE}"
headers = {
    "Authorization": "Bearer ${API_KEY_PLACEHOLDER}",
    "Content-Type": "application/json",
}

# Step 1: submit the video generation job (returns immediately with status "pending")
payload = ${bodyStr}
res = requests.post(f"{BASE}${ctx.submitPath}", headers=headers, json=payload)
res.raise_for_status()
video_id = res.json()["id"]
print(f"Job submitted, video_id: {video_id}")

# Step 2: poll the job status until a terminal state (completed / failed / cancelled)
poll_url = f"{BASE}${pollPath.replace(/\{id\}/g, '{video_id}')}"
while True:
    poll = requests.get(poll_url, headers={"Authorization": "Bearer ${API_KEY_PLACEHOLDER}"})
    poll.raise_for_status()
    result = poll.json()  # task object: { id, status, output: [...], error }
    status = result.get("status", "")
    print(f"Status: {status}")
    if status == "completed":
        # Step 3: download output[].content_url (Bearer required; expires in ~30 minutes)
        content_url = result["output"][0]["content_url"]
        video = requests.get(content_url, headers={"Authorization": "Bearer ${API_KEY_PLACEHOLDER}"})
        with open("video.mp4", "wb") as f:
            f.write(video.content)
        print("saved: video.mp4")
        break
    if status in ("failed", "cancelled"):
        print(f"Job ended ({status}): {result.get('error')}")
        break
    time.sleep(5)`;
}
