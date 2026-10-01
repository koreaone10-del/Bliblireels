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

const makeId = () =>
  crypto.randomUUID();

const send = (
  res,
  data,
  status = 200
) => {
  return res
    .status(status)
    .json(data);
};


/* =========================================================
   BiliBili URL validation
   ========================================================= */

function isSupportedBiliHost(hostname) {
  const h =
    String(hostname || "")
      .toLowerCase()
      .replace(/\.$/, "");

  return (
    h === "b23.tv" ||
    h === "bili.im" ||
    h === "bilibili.com" ||
    h.endsWith(".bilibili.com") ||
    h === "bilibili.tv" ||
    h.endsWith(".bilibili.tv")
  );
}


function validateBiliUrl(value) {
  if (!value) {
    throw new Error(
      "Missing BiliBili URL."
    );
  }

  let url;

  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "Invalid URL."
    );
  }

  if (
    url.protocol !== "http:" &&
    url.protocol !== "https:"
  ) {
    throw new Error(
      "Only HTTP and HTTPS URLs are supported."
    );
  }

  if (
    !isSupportedBiliHost(
      url.hostname
    )
  ) {
    throw new Error(
      "Only BiliBili URLs are supported."
    );
  }

  return url;
}


/* =========================================================
   Resolve short BiliBili links
   ========================================================= */

async function resolveBiliUrl(inputUrl) {
  const parsed =
    validateBiliUrl(inputUrl);

  const host =
    parsed.hostname
      .toLowerCase();

  /*
   * bili.im is a short sharing URL.
   * Resolve it before sending it to yt-dlp.
   */
  if (
    host === "bili.im" ||
    host === "b23.tv"
  ) {
    try {
      const response =
        await fetch(
          inputUrl,
          {
            method: "GET",
            redirect: "follow",
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36",
              "Accept":
                "text/html,application/xhtml+xml"
            },
            signal:
              AbortSignal.timeout(15000)
          }
        );

      const finalUrl =
        response.url;

      if (
        finalUrl &&
        isSupportedBiliHost(
          new URL(finalUrl).hostname
        )
      ) {
        return finalUrl;
      }
    } catch (error) {
      /*
       * Do not fail immediately.
       * yt-dlp may be able to resolve the short URL itself.
       */
      console.warn(
        "[BiliReels] Short URL resolution failed:",
        error.message
      );
    }
  }

  return inputUrl;
}


/* =========================================================
   yt-dlp helper
   ========================================================= */

async function runYtDlp(
  args,
  options = {}
) {
  const baseArgs = [
    "--no-warnings",
    "--no-playlist",
    "--force-ipv4"
  ];

  return exec(
    "yt-dlp",
    [
      ...baseArgs,
      ...args
    ],
    {
      timeout:
        options.timeout ||
        120000,

      maxBuffer:
        options.maxBuffer ||
        12e6,

      env: {
        ...process.env
      }
    }
  );
}


/* =========================================================
   Health
   ========================================================= */

app.get(
  "/health",
  (req, res) => {
    send(res, {
      ok: true,
      service:
        "BiliReels Video Engine",
      timestamp:
        new Date().toISOString()
    });
  }
);


/* =========================================================
   Analyze
   ========================================================= */

app.post(
  "/analyze",
  async (req, res) => {
    const started =
      Date.now();

    try {
      const originalUrl =
        String(
          req.body?.url || ""
        ).trim();

      if (!originalUrl) {
        return send(
          res,
          {
            error:
              "Missing url"
          },
          400
        );
      }

      validateBiliUrl(
        originalUrl
      );

      console.log(
        "[BiliReels] Analyze request:",
        originalUrl
      );

      const resolvedUrl =
        await resolveBiliUrl(
          originalUrl
        );

      console.log(
        "[BiliReels] Resolved URL:",
        resolvedUrl
      );

      /*
       * BiliBili.tv uses the BiliIntl extractor.
       * The normal webpage can require the BiliBili referer.
       */
      const args = [
        "--dump-single-json",
        "--skip-download",

        "--referer",
        "https://www.bilibili.tv/",

        "--add-header",
        "Origin:https://www.bilibili.tv",

        "--add-header",
        "Accept-Language:en-US,en;q=0.9",

        resolvedUrl
      ];

      let stdout;
      let stderr = "";

      try {
        const result =
          await runYtDlp(
            args,
            {
              timeout: 120000,
              maxBuffer: 16e6
            }
          );

        stdout =
          result.stdout;

        stderr =
          result.stderr || "";
      } catch (error) {
        const details = [
          error.message,
          error.stderr,
          error.stdout
        ]
          .filter(Boolean)
          .join("\n");

        console.error(
          "[BiliReels] yt-dlp ANALYZE failed:\n",
          details
        );

        return send(
          res,
          {
            error:
              "yt-dlp failed while analyzing the BiliBili video.",

            details:
              details.slice(
                0,
                5000
              ),

            originalUrl,

            resolvedUrl
          },
          502
        );
      }

      let info;

      try {
        info =
          JSON.parse(
            stdout
          );
      } catch {
        console.error(
          "[BiliReels] yt-dlp returned invalid JSON:",
          stdout?.slice(0, 3000)
        );

        return send(
          res,
          {
            error:
              "yt-dlp returned invalid metadata.",

            details:
              stderr ||
              stdout?.slice(
                0,
                5000
              ),

            originalUrl,

            resolvedUrl
          },
          502
        );
      }

      const response = {
        id:
          info.id || null,

        bvid:
          info.bvid ||
          (
            typeof info.id === "string" &&
            info.id.startsWith("BV")
              ? info.id
              : null
          ),

        title:
          info.title ||
          "BiliBili Video",

        duration:
          Number(
            info.duration
          ) || 0,

        thumbnail:
          info.thumbnail ||
          null,

        author:
          info.uploader ||
          info.channel ||
          info.creator ||
          "",

        webpageUrl:
          info.webpage_url ||
          resolvedUrl,

        sourceUrl:
          resolvedUrl,

        originalUrl,

        extractor:
          info.extractor ||
          null,

        extractorKey:
          info.extractor_key ||
          null
      };

      console.log(
        `[BiliReels] Analyze OK in ${Date.now() - started}ms`,
        {
          id: response.id,
          title: response.title,
          extractor:
            response.extractor
        }
      );

      return send(
        res,
        response,
        200
      );
    } catch (error) {
      console.error(
        "[BiliReels] Analyze unexpected error:",
        error
      );

      return send(
        res,
        {
          error:
            error.message ||
            "Analyze failed"
        },
        500
      );
    }
  }
);


/* =========================================================
   Create processing job
   ========================================================= */

app.post(
  "/jobs",
  async (req, res) => {
    try {
      const payload =
        req.body || {};

      const sourceUrl =
        String(
          payload.sourceUrl || ""
        ).trim();

      if (!sourceUrl) {
        throw new Error(
          "Missing sourceUrl"
        );
      }

      validateBiliUrl(
        sourceUrl
      );

      const jobId =
        makeId();

      const dir =
        await fs.mkdtemp(
          path.join(
            os.tmpdir(),
            "blibireels-"
          )
        );

      const job = {
        jobId,

        status:
          "queued",

        progress:
          0,

        message:
          "Queued",

        error:
          null,

        dir,

        reels:
          [],

        zipUrl:
          null,

        createdAt:
          Date.now()
      };

      jobs.set(
        jobId,
        job
      );

      runJob(
        jobId,
        payload
      ).catch(
        (error) => {
          const current =
            jobs.get(jobId);

          if (!current) {
            return;
          }

          current.status =
            "failed";

          current.error =
            error.message ||
            "Processing failed";

          current.message =
            current.error;

          console.error(
            `[BiliReels] Job ${jobId} failed:`,
            error
          );
        }
      );

      return send(
        res,
        {
          jobId,
          status:
            "queued",
          message:
            "Job queued"
        },
        202
      );
    } catch (error) {
      return send(
        res,
        {
          error:
            error.message ||
            "Unable to create job"
        },
        400
      );
    }
  }
);


/* =========================================================
   Job status
   ========================================================= */

app.get(
  "/jobs/:id",
  (req, res) => {
    const job =
      jobs.get(
        req.params.id
      );

    if (!job) {
      return send(
        res,
        {
          error:
            "Job not found"
        },
        404
      );
    }

    return send(
      res,
      {
        jobId:
          job.jobId,

        status:
          job.status,

        progress:
          job.progress,

        message:
          job.message,

        error:
          job.error,

        reels:
          job.reels,

        zipUrl:
          job.zipUrl
      }
    );
  }
);


/* =========================================================
   Serve generated files
   ========================================================= */

app.get(
  "/files/:id/:name",
  async (req, res) => {
    const job =
      jobs.get(
        req.params.id
      );

    if (!job) {
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

    const filePath =
      path.join(
        job.dir,
        name
      );

    try {
      const stat =
        await fs.stat(
          filePath
        );

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

      const {
        createReadStream
      } = await import(
        "node:fs"
      );

      createReadStream(
        filePath
      ).pipe(res);
    } catch {
      return res
        .status(404)
        .end();
    }
  }
);


/* =========================================================
   Processing
   ========================================================= */

async function runJob(
  jobId,
  payload
) {
  const job =
    jobs.get(jobId);

  if (!job) {
    throw new Error(
      "Job not found"
    );
  }

  job.status =
    "processing";

  job.progress =
    0.02;

  job.message =
    "Resolving BiliBili URL…";

  const sourceUrl =
    await resolveBiliUrl(
      payload.sourceUrl
    );

  job.message =
    "Downloading BiliBili video…";

  job.progress =
    0.05;

  const outputTemplate =
    path.join(
      job.dir,
      "source.%(ext)s"
    );

  const quality =
    payload.quality ===
    "1080p"
      ? "1080p"
      : payload.quality ===
        "480p"
        ? "480p"
        : "720p";

  const format =
    quality === "1080p"
      ? "bv*[height<=1080]+ba/b"
      : quality === "480p"
        ? "bv*[height<=480]+ba/b"
        : "bv*[height<=720]+ba/b";

  try {
    await runYtDlp(
      [
        "-f",
        format,

        "--merge-output-format",
        "mp4",

        "--referer",
        "https://www.bilibili.tv/",

        "--add-header",
        "Origin:https://www.bilibili.tv",

        "--add-header",
        "Accept-Language:en-US,en;q=0.9",

        "-o",
        outputTemplate,

        sourceUrl
      ],
      {
        timeout:
          30 * 60 * 1000,
        maxBuffer:
          8e6
      }
    );
  } catch (error) {
    const details = [
      error.message,
      error.stderr,
      error.stdout
    ]
      .filter(Boolean)
      .join("\n");

    console.error(
      `[BiliReels] Job ${jobId} download failed:\n`,
      details
    );

    throw new Error(
      `BiliBili download failed: ${details.slice(
        0,
        4000
      )}`
    );
  }

  const files =
    await fs.readdir(
      job.dir
    );

  const source =
    files.find(
      (file) =>
        file.startsWith(
          "source."
        ) &&
        file.endsWith(
          ".mp4"
        )
    );

  if (!source) {
    throw new Error(
      "Download completed but no MP4 file was produced."
    );
  }

  job.progress =
    0.25;

  job.message =
    "Encoding 9:16 Reels…";

  const seconds =
    Math.max(
      10,
      Math.min(
        600,
        Number(
          payload.split?.duration
        ) || 30
      )
    );

  let width =
    720;

  let height =
    1280;

  if (
    quality === "1080p"
  ) {
    width =
      1080;

    height =
      1920;
  }

  if (
    quality === "480p"
  ) {
    width =
      480;

    height =
      854;
  }

  const sourcePath =
    path.join(
      job.dir,
      source
    );

  await exec(
    "ffmpeg",
    [
      "-y",

      "-i",
      sourcePath,

      "-vf",
      `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,

      "-map",
      "0:v:0",

      "-map",
      "0:a:0?",

      "-c:v",
      "libx264",

      "-preset",
      "veryfast",

      "-crf",
      quality === "1080p"
        ? "20"
        : quality === "720p"
          ? "21"
          : "23",

      "-c:a",
      "aac",

      "-b:a",
      "128k",

      "-f",
      "segment",

      "-segment_time",
      String(seconds),

      "-reset_timestamps",
      "1",

      "-segment_format",
      "mp4",

      path.join(
        job.dir,
        "reel_%03d.mp4"
      )
    ],
    {
      timeout:
        40 * 60 * 1000,

      maxBuffer:
        8e6
    }
  );

  const generated =
    (
      await fs.readdir(
        job.dir
      )
    )
      .filter(
        (file) =>
          /^reel_\d+\.mp4$/.test(
            file
          )
      )
      .sort();

  if (!generated.length) {
    throw new Error(
      "FFmpeg produced no Reel files."
    );
  }

  const publicBase =
    String(
      process.env.PUBLIC_BASE_URL ||
      ""
    )
      .replace(/\/$/, "");

  job.reels =
    generated.map(
      (file, index) => ({
        filename:
          `BiliReels_Reel_${String(
            index + 1
          ).padStart(
            3,
            "0"
          )}.mp4`,

        quality,

        width,

        height,

        duration:
          seconds,

        url:
          publicBase
            ? `${publicBase}/files/${jobId}/${file}`
            : null
      })
    );

  job.progress =
    0.95;

  job.message =
    "Creating ZIP…";

  const zipName =
    "BiliReels_Reels.zip";

  await exec(
    "zip",
    [
      "-j",

      path.join(
        job.dir,
        zipName
      ),

      ...generated.map(
        (file) =>
          path.join(
            job.dir,
            file
          )
      )
    ],
    {
      timeout:
        120000,

      maxBuffer:
        4e6
    }
  );

  job.zipUrl =
    publicBase
      ? `${publicBase}/files/${jobId}/${zipName}`
      : null;

  job.progress =
    1;

  job.status =
    "completed";

  job.message =
    `Created ${generated.length} Reel(s).`;
}


/* =========================================================
   Cleanup
   ========================================================= */

setInterval(
  async () => {
    const now =
      Date.now();

    for (
      const [jobId, job]
      of jobs
    ) {
      if (
        now -
          job.createdAt >
        TTL
      ) {
        await fs.rm(
          job.dir,
          {
            recursive:
              true,
            force:
              true
          }
        ).catch(
          () => {}
        );

        jobs.delete(
          jobId
        );
      }
    }
  },
  60000
);


/* =========================================================
   Start
   ========================================================= */

app.listen(
  PORT,
  () => {
    console.log(
      `BiliReels Video Engine listening on port ${PORT}`
    );
  }
);
