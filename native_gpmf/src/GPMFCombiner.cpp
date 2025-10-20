#include "GPMFCombiner.h"
#include <sstream>
#include <filesystem>
#include <fstream>
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

void mergeVideos(const std::vector<GPMFResult> &results, const std::string &outputPath)
{
    // Derive folder path from outputPath
    std::filesystem::path outPath(outputPath);
    std::filesystem::path folder = outPath.parent_path();
    if (folder.empty())
        folder = std::filesystem::current_path();

    std::filesystem::path listFile = folder / "concat_list.txt";
    std::ofstream out(listFile);

    if (!out)
    {
        std::cerr << "[ERROR] Unable to write concat_list.txt\n";
        return;
    }

    // Write files in the same order used for telemetry merging
    for (const auto &res : results)
    {
        out << "file '" << res.source_filename << "'\n";
    }

    out.close();

    std::string command =
        "ffmpeg -y -f concat -safe 0 -i \"" + listFile.string() + "\" -c copy \"" + outputPath + "\"";

    std::cout << "[INFO] Combining videos into " << outputPath << " using command '" + command + "'\n";
    int ret = std::system(command.c_str());

    if (ret != 0)
        std::cerr << "[ERROR] ffmpeg failed with code " << ret << "\n";
    else
        std::cout << "[INFO] Combined video written to " << outputPath << "\n";
}

// ------------------------------------------------------------
// Combine multiple GPMFResult objects into one continuous dataset
// ------------------------------------------------------------
GPMFResult GPMFCombiner::combineResults(const std::vector<GPMFResult> &resultsInput, std::string mp4filename)
{
    GPMFResult empty;
    if (resultsInput.empty())
        return empty;

    // Work on a local copy (we will mutate gps arrays when trimming invalid samples)
    std::vector<GPMFResult> results = resultsInput;

    // --- 1) Detect internal bad-gps jumps (2015 → real time) and trim
    //    We treat a "huge" jump as year-sized by default, but you can lower it.
    const double JUMP_THRESHOLD = 31556952.0; // 1 year (seconds)
    for (auto &clip : results)
    {
        if (clip.gpsu_epochs.empty())
            continue;

        size_t jump_index = SIZE_MAX;
        for (size_t j = 1; j < clip.gpsu_epochs.size(); ++j)
        {
            double delta = clip.gpsu_epochs[j] - clip.gpsu_epochs[j - 1];
            if (delta > JUMP_THRESHOLD)
            {
                jump_index = j;
                double good_epoch = clip.gpsu_epochs[j];
                clip.creation_time_iso = epochToIso(good_epoch);
                std::cerr << "[WARN] " << clip.source_filename
                          << ": detected large GPSU jump (" << delta / 3600.0
                          << " h). Trimming first " << j << " samples and resetting creation_time to "
                          << clip.creation_time_iso << ".\n";
                break;
            }
        }

        if (jump_index != SIZE_MAX)
        {
            // Remove earlier (invalid) gpsu epochs and gps_points to keep arrays aligned.
            if (jump_index < clip.gpsu_epochs.size())
                clip.gpsu_epochs.erase(clip.gpsu_epochs.begin(), clip.gpsu_epochs.begin() + jump_index);

            if (jump_index < clip.gps_points.size())
                clip.gps_points.erase(clip.gps_points.begin(), clip.gps_points.begin() + jump_index);
        }
    }

    // --- 2) Sort clips by creation_time (chronological order) ---
    std::sort(results.begin(), results.end(),
              [](const GPMFResult &a, const GPMFResult &b)
              {
                  return isoToEpoch(a.creation_time_iso) < isoToEpoch(b.creation_time_iso);
              });

    // --- 3) Prepare merged result and base start epoch ---
    GPMFResult merged;
    merged.source_filename = "merged";
    merged.creation_time_iso = results.front().creation_time_iso;

    double base_start_epoch = isoToEpoch(results.front().creation_time_iso);

    merged.pts_times.clear();
    merged.gpsu_epochs.clear();
    merged.gps_points.clear();

    // --- 4) For each clip, compute absolute shift = clip_start_epoch - base_start_epoch
    //           then convert per-clip pts_times -> merged timeline, append gpsu_epochs & gps_points
    for (size_t i = 0; i < results.size(); ++i)
    {
        const GPMFResult &clip = results[i];

        double clip_start_epoch = isoToEpoch(clip.creation_time_iso);
        double shift_seconds = clip_start_epoch - base_start_epoch; // seconds from base

        // Determine clip duration from pts_times (last element) if available
        double clip_duration = 0.0;
        if (!clip.pts_times.empty())
            clip_duration = clip.pts_times.back();

        std::cerr << "[INFO] Clip " << (i + 1) << " (" << clip.source_filename
                  << ") start=" << clip.creation_time_iso
                  << " shift=" << shift_seconds
                  << " dur=" << clip_duration << "s\n";

        // Convert per-clip pts_times to merged timeline: pts_local + shift_seconds
        for (double t : clip.pts_times)
        {
            double merged_t = t + shift_seconds;
            merged.pts_times.push_back(merged_t);
        }

        // For gpsu_epochs:
        // - These are stored as absolute epoch seconds in extractor.
        // - We append them as-is (absolute epochs). If you prefer relative seconds
        //   since base_start, convert: gpsu_epoch - base_start_epoch.
        for (double e : clip.gpsu_epochs)
        {
            merged.gpsu_epochs.push_back(e);
        }

        // GPS points: keep the actual geo records (lat/lon/ele/time string).
        for (const auto &p : clip.gps_points)
        {
            merged.gps_points.push_back(p);
        }
    }

    // Optionally: sort merged gps_points by time to ensure monotonic order (if needed)
    // If gps_points.iso_time are ISO strings, you'd convert -> epoch and sort by epoch.
    // Here, we assume concatenation order is chronological after the above shifts/trims.
    //
    // If you want to guarantee ordering:
    //   convert each gps_point.iso_time -> epoch and sort merged.gps_points accordingly.

    mergeVideos(results, mp4filename);

    return merged;
}
