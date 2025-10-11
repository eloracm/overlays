import fs from "fs";
import xml2js from "xml2js";

const inputFile = "track_ext.gpx";
const outputFile = "points.json";

const xml = fs.readFileSync(inputFile, "utf8");

xml2js.parseString(xml, (err, result) => {
    if (err) throw err;

    // Navigate the GPX structure safely
    const trkpts = result.gpx.trk?.[0].trkseg?.[0].trkpt;
    if (!trkpts) {
        console.error("No trackpoints found in GPX!");
        process.exit(1);
    }

    const points = trkpts.map(pt => ({
        lat: parseFloat(pt.$.lat),
        lon: parseFloat(pt.$.lon),
        ele: pt.ele ? parseFloat(pt.ele[0]) : 0,
        time: pt.time ? pt.time[0] : null,
    })).filter(p => p.time);

    fs.writeFileSync(outputFile, JSON.stringify(points, null, 2));
    console.log(`✅ Saved ${points.length} points to ${outputFile}`);
});
