import { execFile, spawn } from "child_process";
import express from "express";
import fs from "fs/promises";
import fsSync from "fs";
import { promisify } from "node:util";
import os from "os";
import path from "path";
import turfArea from "@turf/area";

const app = express();
// TODO Input polygon should be way smaller
app.use(express.json({ limit: "1mb" }));

const PORT = 3000;
const LOGFILE = "requests.log";
const MAX_AREA_M2 = 5 * 10e7;
const INPUT_GOL = "/Users/dabreegster/Downloads/england.gol";
const OSMIUM = "/opt/homebrew/bin/osmium";
const GOL = "/Users/dabreegster/Downloads/gol";

app.post("/", async (req, resp) => {
  const start = Date.now();

  const geojson = req.body;
  const [areaM2, err] = validateRequest(geojson, resp);
  if (err) {
    return err;
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "osm-extractor-"));
  console.log(`Working on a request in ${tmpDir}`);
  const inputPath = path.join(tmpDir, "input_polygon.geojson");
  const xmlOutPath = path.join(tmpDir, "tmp_output.xml");
  const pbfOutPath = path.join(tmpDir, "output.pbf");

  try {
    // gol just takes the geometry, it gets confused by the whole feature
    await fs.writeFile(inputPath, JSON.stringify(geojson.geometry));

    await runCommandWithOutputFile(
      GOL,
      ["query", INPUT_GOL, "-a", inputPath, "-f", "xml", "*"],
      xmlOutPath,
    );

    // gol outputs XML, not PBF, and it includes very long ways and relations that cross the
    // boundary. Use osmium to do a second pass.
    await promisify(execFile)(OSMIUM, [
      "extract",
      "--polygon",
      inputPath,
      xmlOutPath,
      "-o",
      pbfOutPath,
    ]);
    const pbfBuffer = await fs.readFile(pbfOutPath);

    const totalMs = Date.now() - start;
    geojson.properties.stats = {
      time: new Date().toISOString(),
      duration_ms: totalMs,
      area_m2: areaM2,
    };
    try {
      await fs.appendFile(LOGFILE, JSON.stringify(geojson));
    } catch (err) {
      console.error(`Problem writing to log: ${err}`);
    }

    console.log(`Request succeeded, taking ${totalMs} ms`);
    resp.setHeader("Content-Type", "application/octet-stream");
    resp.setHeader("Content-Length", String(pbfBuffer.length));
    return resp.send(pbfBuffer);
  } catch (err) {
    geojson.properties.stats = {
      time: new Date().toISOString(),
      duration_ms: Date.now() - start,
      area_m2: areaM2,
      error: String(err),
    };
    try {
      await fs.appendFile(LOGFILE, JSON.stringify(geojson));
    } catch (err) {
      console.error(`Problem writing to log: ${err}`);
    }

    console.error(`Request failed: ${err}`);
    return resp
      .status(500)
      .json({ error: "Processing failed", detail: String(err) });
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (err) {
      console.error(`Problem cleaning up ${tmpDir}: ${err}`);
    }
  }
});

app.listen(PORT, () => {
  console.log(`osm-extractor running on port ${PORT}`);
});

// Takes the request body. Returns [areaM2, returnable error response] as an Either.
function validateRequest(geojson, resp) {
  if (
    !geojson ||
    geojson.type != "Feature" ||
    !geojson.geometry ||
    geojson.geometry.type != "Polygon" ||
    !geojson.properties
  ) {
    return [
      0,
      resp.status(400).json({
        error:
          "Request must be a GeoJSON Feature with a Polygon and a properties dictionary",
      }),
    ];
  }

  let areaM2;
  try {
    areaM2 = turfArea(geojson);
  } catch (err) {
    return [
      0,
      resp
        .status(400)
        .json({ error: `Input doesn't look like a valid polygon: ${err}` }),
    ];
  }

  if (areaM2 > MAX_AREA_M2) {
    return [
      0,
      resp.status(400).json({
        error: `Polygon area ${Math.round(areaM2).toLocaleString()} m^2 exceeds limit of ${MAX_AREA_M2.toLocaleString()} m^2.`,
      }),
    ];
  }

  return [areaM2, null];
}

// Run a command, redirecting STDOUT to a file
function runCommandWithOutputFile(cmd, args, outFile) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);

    const outStream = fsSync.createWriteStream(outFile);
    child.stdout.pipe(outStream);

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      outStream.close();
      reject(err);
    });

    child.on("close", (code) => {
      outStream.close();
      if (code == 0) {
        return resolve();
      }
      reject(
        new Error(
          `'${cmd} ${args.join(" ")}' exited with code ${code}: ${stderr}`,
        ),
      );
    });
  });
}
