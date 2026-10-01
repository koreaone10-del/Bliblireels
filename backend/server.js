import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

const app = express();

app.use(cors());
app.use(express.json({ limit: "256kb" }));

const PORT = process.env.PORT || 8080;
const jobs = new Map();
const TTL = Number(
  process.env.JOB_TTL_MS || 3600000
);

const id = () => crypto.randomUUID();

const clean = (s) =>
  String(s || "file")
    .replace(/[^\w.-]+/g, "_")
    .slice(0, 90);

const send = (res, data, status = 200) =>
  res.status(status).json(data);


/*
|--------------------------------------------------------------------------
| BiliBili URL validation
|--------------------------------------------------------------------------
|
| Supported:
|   - bilibili.com
|   - *.bilibili.com
|   - bilibili.tv
|   - *.bilibili.tv
|   - b23.tv
|   - bili.im
|
*/

function validBili(url) {
  let u;

  try {
    u = new URL(url);
  } catch {
    throw new Error(
      "Invalid BiliBili URL."
    );
  }

  const h = u.hostname.toLowerCase();

  const isSupported =
    h === "b23.tv" ||
    h === "bili.im" ||
    h === "bilibili.com" ||
    h.endsWith(".bilibili.com") ||
    h === "bilibili.tv" ||
    h.endsWith(".bilibili.tv");

  if (!isSupported) {
    throw new Error(
      "Only BiliBili URLs are supported."
    );
  }

  return true;
}


/*
|--------------------------------------------------------------------------
| Health
|--------------------------------------------------------------------------
*/

app.get(
  "/health",
  (req, res) => {
    send(res, {
      ok: true,
      service: "BiliReels Video Engine"
    });
  }
);


/*
|--------------------------------------------------------------------------
| Analyze BiliBili video
|--------------------------------------------------------------------------
*/

app.post(
  "/analyze",
  async (req, res) => {
    try {
      const url = req.body?.url;

      if (!url) {
        throw new Error(
          "Missing url"
        );
      }

      validBili(url);

      const { stdout } =
        await exec(
          "yt-dlp",
          [
            "--dump-single-json",
            "--skip-download",
            "--no-warnings",
            "--no-playlist",
            url
          ],
          {
            timeout: 90000,
            maxBuffer: 8e6
          }
        );

      const data =
        JSON.parse(stdout);

      send(res, {
        id: data.id,

        bvid:
          data.id?.startsWith("BV")
            ? data.id
            : null,

        title:
          data.title ||
          "BiliBili Video",

        duration:
          Number(data.duration) || 0,

        thumbnail:
          data.thumbnail || null,

        author:
          data.uploader ||
          data.channel ||
          "",

        webpageUrl:
          data.webpage_url ||
          url
      });
    } catch (error) {
      send(
        res,
        {
          error:
            error.message ||
            "Analyze failed"
        },
        502
      );
    }
  }
);


/*
|--------------------------------------------------------------------------
| Create processing job
|--------------------------------------------------------------------------
*/

app.post(
  "/jobs",
  async (req, res) => {
    try {
      const p = req.body || {};

      validBili(
        p.sourceUrl
      );

      const jobId = id();

      const dir =
        await fs.mkdtemp(
          path.join(
            os.tmpdir(),
            "br-"
          )
        );

      jobs.set(
        jobId,
        {
          jobId,
          status: "queued",
          progress: 0,
          message: "Queued",
          dir,
          reels: [],
          zipUrl: null,
          createdAt: Date.now()
        }
      );

      run(
        jobId,
        p
      ).catch((error) => {
        const j =
          jobs.get(jobId);

        if (j) {
          j.status = "failed";
          j.error =
            error.message;
          j.message =
            error.message;
        }
      });

      send(
        res,
        {
          jobId,
          status: "queued",
          message: "Job queued"
        },
        202
      );
    } catch (error) {
      send(
        res,
        {
          error:
            error.message
        },
        400
      );
    }
  }
);


/*
|--------------------------------------------------------------------------
| Job status
|--------------------------------------------------------------------------
*/

app.get(
  "/jobs/:id",
  (req, res) => {
    const j =
      jobs.get(
        req.params.id
      );

    if (!j) {
      return send(
        res,
        {
          error:
            "Job not found"
        },
        404
      );
    }

    send(res, {
      jobId: j.jobId,
      status: j.status,
      progress: j.progress,
      message: j.message,
      error: j.error || null,
      reels: j.reels,
      zipUrl: j.zipUrl
    });
  }
);


/*
|--------------------------------------------------------------------------
| Serve generated files
|--------------------------------------------------------------------------
*/

app.get(
  "/files/:id/:name",
  async (req, res) => {
    const j =
      jobs.get(
        req.params.id
      );

    if (!j) {
      return res
        .status(404)
        .end();
    }

    const name =
      path.basename(
        req.params.name
      );

    if (
      !name.endsWith(".mp4") &&
      !name.endsWith(".zip")
    ) {
      return res
        .status(400)
        .end();
    }

    const file =
      path.join(
        j.dir,
        name
      );

    try {
      const stat =
        await fs.stat(file);

      res.setHeader(
        "Content-Type",
        name.endsWith(".zip")
          ? "application/zip"
          : "video/mp4"
      );

      res.setHeader(
        "Content-Length",
        stat.size
      );

      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${name}"`
      );

      (
        await import("node:fs")
      )
        .createReadStream(file)
        .pipe(res);
    } catch {
      res
        .status(404)
        .end();
    }
  }
);


/*
|--------------------------------------------------------------------------
| Video processing
|--------------------------------------------------------------------------
*/

async function run(jobId, p) {
  const j =
    jobs.get(jobId);

  if (!j) {
    throw new Error(
      "Job not found"
    );
  }

  j.status = "processing";
  j.message =
    "Downloading from BiliBili…";


  /*
  |--------------------------------------------------------------------------
  | Download source
  |--------------------------------------------------------------------------
  */

  const src =
    path.join(
      j.dir,
      "source.%(ext)s"
    );

  await exec(
    "yt-dlp",
    [
      "--no-playlist",

      "-f",
      "bv*+ba/b",

      "--merge-output-format",
      "mp4",

      "-o",
      src,

      p.sourceUrl
    ],
    {
      timeout:
        25 * 60 * 1000,

      maxBuffer:
        4e6
    }
  );


  /*
  |--------------------------------------------------------------------------
  | Find downloaded MP4
  |--------------------------------------------------------------------------
  */

  const fsys =
    await fs.readdir(
      j.dir
    );

  const source =
    fsys.find(
      (x) =>
        x.startsWith("source.") &&
        x.endsWith(".mp4")
    );

  if (!source) {
    throw new Error(
      "Download did not produce MP4"
    );
  }


  /*
  |--------------------------------------------------------------------------
  | Encoding
  |--------------------------------------------------------------------------
  */

  j.progress = 0.25;

  j.message =
    "Encoding 9:16 Reels…";


  let q = "720p";

  if (p.quality === "1080p") {
    q = "1080p";
  } else if (
    p.quality === "480p"
  ) {
    q = "480p";
  }


  let w = 720;
  let h = 1280;

  if (q === "1080p") {
    w = 1080;
    h = 1920;
  }

  if (q === "480p") {
    w = 480;
    h = 854;
  }


  const seg =
    Math.max(
      10,
      Math.min(
        600,
        Number(
          p.split?.duration
        ) || 30
      )
    );


  await exec(
    "ffmpeg",
    [
      "-y",

      "-i",
      path.join(
        j.dir,
        source
      ),

      "-vf",
      `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`,

      "-map",
      "0:v:0",

      "-map",
      "0:a:0?",

      "-c:v",
      "libx264",

      "-preset",
      "veryfast",

      "-crf",
      q === "1080p"
        ? "20"
        : q === "720p"
          ? "21"
          : "23",

      "-c:a",
      "aac",

      "-b:a",
      "128k",

      "-f",
      "segment",

      "-segment_time",
      String(seg),

      "-reset_timestamps",
      "1",

      "-segment_format",
      "mp4",

      "-movflags",
      "+faststart",

      path.join(
        j.dir,
        "reel_%03d.mp4"
      )
    ],
    {
      timeout:
        35 * 60 * 1000,

      maxBuffer:
        4e6
    }
  );


  /*
  |--------------------------------------------------------------------------
  | Find generated Reels
  |--------------------------------------------------------------------------
  */

  const outs =
    (
      await fs.readdir(
        j.dir
      )
    )
      .filter(
        (x) =>
          /^reel_\d+\.mp4$/.test(x)
      )
      .sort();


  if (!outs.length) {
    throw new Error(
      "FFmpeg produced no clips"
    );
  }


  /*
  |--------------------------------------------------------------------------
  | Public URLs
  |--------------------------------------------------------------------------
  */

  const base =
    process.env.PUBLIC_BASE_URL
      ?.replace(/\/$/, "") ||
    "";


  j.reels =
    outs.map(
      (name, index) => ({
        filename:
          `BiliReels_Reel_${String(
            index + 1
          ).padStart(
            3,
            "0"
          )}.mp4`,

        duration: seg,

        quality: q,

        width: w,

        height: h,

        url: base
          ? `${base}/files/${jobId}/${name}`
          : null
      })
    );


  /*
  |--------------------------------------------------------------------------
  | ZIP
  |--------------------------------------------------------------------------
  */

  j.progress = 1;

  j.status =
    "completed";

  j.message =
    `Created ${outs.length} Reel(s).`;


  const zipName =
    "BiliReels_Reels.zip";


  await exec(
    "zip",
    [
      "-j",

      path.join(
        j.dir,
        zipName
      ),

      ...outs.map(
        (name) =>
          path.join(
            j.dir,
            name
          )
      )
    ]
  );


  j.zipUrl = base
    ? `${base}/files/${jobId}/${zipName}`
    : null;
}


/*
|--------------------------------------------------------------------------
| Cleanup old jobs
|--------------------------------------------------------------------------
*/

setInterval(
  async () => {
    const now =
      Date.now();

    for (
      const [key, job]
      of jobs
    ) {
      if (
        now - job.createdAt >
        TTL
      ) {
        await fs.rm(
          job.dir,
          {
            recursive: true,
            force: true
          }
        ).catch(
          () => {}
        );

        jobs.delete(key);
      }
    }
  },
  60000
);


/*
|--------------------------------------------------------------------------
| Start server
|--------------------------------------------------------------------------
*/

app.listen(
  PORT,
  () => {
    console.log(
      `BiliReels engine on ${PORT}`
    );
  }
);
