#include "GPMFCombiner.h"
#include <sstream>
#include <iomanip>
#include <algorithm>
#include <iostream>
#include <ctime>
#include <cmath>
#include <cctype>

using namespace std;

// ------------------------------------------------------------
// Helper: convert epoch → ISO string
// ------------------------------------------------------------
static std::string epochToIso(double epoch)
{
    if (epoch <= 0.0)
        return "";
    std::time_t tt = static_cast<time_t>(epoch);
    std::tm *gmt = std::gmtime(&tt);
    std::ostringstream iso_out;
    iso_out << std::put_time(gmt, "%Y-%m-%dT%H:%M:%S");
    return iso_out.str();
}

// ------------------------------------------------------------
// Combine multiple GPMFResult objects into one continuous dataset
// ------------------------------------------------------------
GPMFResult GPMFCombiner::combineResults(const std::vector<GPMFResult> &input)
{
    GPMFResult merged;

    if (input.empty())
    {
        std::cerr << "[WARN] combineResults(): no input results.\n";
        return merged;
    }

    // Copy and normalize creation times
    std::vector<GPMFResult> results = input;

    // --- Sanity check and fallback for each clip ---
    for (size_t i = 0; i < results.size(); ++i)
    {
        auto &clip = results[i];
        double clip_start = isoToEpoch(clip.creation_time_iso);
        double gps_first = !clip.gpsu_epochs.empty() ? clip.gpsu_epochs.front() : 0.0;

        bool badTime = false;
        if (clip_start == 0.0)
            badTime = true;
        else if (gps_first > 0.0 && std::fabs(clip_start - gps_first) > 86400.0 * 365)
            badTime = true; // over a year off

        if (badTime)
        {
            if (gps_first > 0.0)
            {
                clip.creation_time_iso = epochToIso(gps_first);
                std::cerr << "[WARN] " << i + 1
                          << ": creation_time invalid; using GPSU "
                          << clip.creation_time_iso << "\n";
            }
            else
            {
                std::cerr << "[WARN] " << i + 1
                          << ": no creation_time or GPSU available, using epoch 0\n";
                clip.creation_time_iso = "1970-01-01T00:00:00";
            }
        }
    }

    // --- Sort by creation time, tie-breaking by filename ---
    std::sort(results.begin(), results.end(),
              [](const GPMFResult &a, const GPMFResult &b)
              {
                  if (a.creation_time_iso == b.creation_time_iso)
                      return a.source_filename < b.source_filename; // GX01 < GX02
                  return a.creation_time_iso < b.creation_time_iso;
              });

    merged.creation_time_iso = results.front().creation_time_iso;

    double base_epoch = isoToEpoch(results.front().creation_time_iso);
    double accumulated_offset = 0.0;

    std::cerr << "[INFO] Combining " << results.size() << " clips...\n";

    for (size_t i = 0; i < results.size(); ++i)
    {
        const auto &clip = results[i];
        double clip_start_epoch = isoToEpoch(clip.creation_time_iso);
        double time_shift = accumulated_offset;

        // Calculate duration for offset chaining
        double clip_duration = 0.0;
        if (!clip.pts_times.empty())
            clip_duration = clip.pts_times.back() - clip.pts_times.front();
        else if (!clip.gpsu_epochs.empty())
            clip_duration = clip.gpsu_epochs.back() - clip.gpsu_epochs.front();

        if (i > 0)
            accumulated_offset += clip_duration;

        std::cerr << "[INFO] Clip " << i + 1 << " "
                  << "(" << clip.source_filename << ") "
                  << "start=" << clip.creation_time_iso
                  << " shift=" << time_shift
                  << " dur=" << clip_duration << "s\n";

        // ---- Merge PTS ----
        for (double t : clip.pts_times)
            merged.pts_times.push_back(t + time_shift);

        // ---- Merge GPSU epochs ----
        for (double e : clip.gpsu_epochs)
            merged.gpsu_epochs.push_back(e + time_shift);

        // ---- Merge GPS points ----
        for (auto p : clip.gps_points)
        {
            if (!p.iso_time.empty())
            {
                double epoch = isoToEpoch(p.iso_time);
                epoch += time_shift;
                p.iso_time = epochToIso(epoch);
            }
            merged.gps_points.push_back(p);
        }
    }

    // ---- Derive merged time bounds ----
    if (!merged.pts_times.empty())
    {
        merged.startMs = merged.pts_times.front() * 1000.0;
        merged.endMs = merged.pts_times.back() * 1000.0;
    }

    std::cerr << "[INFO] Combined telemetry from "
              << results.size() << " clips into unified timeline.\n";

    return merged;
}
