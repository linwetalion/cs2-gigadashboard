import { createReadStream, createWriteStream, statSync } from "node:fs";
import unbzip2 from "unbzip2-stream";

const input = "data/demos/sample.dem.bz2";
const output = "data/demos/sample.dem";

await new Promise((resolve, reject) => {
  createReadStream(input)
    .pipe(unbzip2())
    .pipe(createWriteStream(output))
    .on("finish", resolve)
    .on("error", reject);
});

console.log("decompressed", statSync(output).size);
