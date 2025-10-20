#include "GPMFWriter.h"
#include <iostream>
#include <fstream>
#include <iomanip>
#include <nlohmann/json.hpp>

using json = nlohmann::json;

void writeMetaJson(const GPMFResult &result, const std::string &outPath)
{
    json meta;
    meta["creation_time"] = result.creation_time_iso;
    meta["frame_rate"] = result.fps;
    meta["pts_times"] = result.pts_times;
    meta["gpsu_epochs"] = result.gpsu_epochs;
    meta["gps_point_count"] = result.gps_points.size();
    meta["speed_factor"] = result.speed_factor;

    std::ofstream(outPath) << std::setw(2) << meta;
    std::cout << "[OK] Wrote JSON metadata: " << outPath << std::endl;
}

void writeGPX(const GPMFResult &result, const std::string &outPath)
{
    std::ofstream gpx(outPath);
    gpx << "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
        << "<gpx xmlns=\"http://www.topografix.com/GPX/1/1\" version=\"1.1\" creator=\"gpmf_merge\">\n"
        << "  <trk>\n    <trkseg>\n";

    gpx << std::fixed;
    for (const auto &p : result.gps_points)
    {
        gpx << "      <trkpt lat=\"" << std::setprecision(7) << p.lat
            << "\" lon=\"" << std::setprecision(7) << p.lon << "\">\n"
            << "        <ele>" << std::setprecision(3) << p.ele << "</ele>\n";
        if (!p.iso_time.empty())
            gpx << "        <time>" << p.iso_time << "</time>\n";
        gpx << "      </trkpt>\n";
    }

    gpx << "    </trkseg>\n  </trk>\n</gpx>\n";
    std::cout << "[OK] Wrote GPX: " << outPath << std::endl;
}
