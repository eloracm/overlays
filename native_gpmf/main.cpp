#include <iostream>
#include <filesystem>
#include <vector>
#include "GPMFExtractor.h"
#include "GPMFCombiner.h"
#include "GPMFWriter.h"

int main(int argc, char *argv[])
{
    try
    {
        // ✅ Default folder or user-specified argument
        std::string folder = "data";
        if (argc > 1)
            folder = argv[1];

        // Normalize folder path
        if (!std::filesystem::exists(folder))
        {
            std::cerr << "[ERROR] Folder not found: " << folder << "\n";
            std::cerr << "Usage: gpmf_dump <folder_path>\n";
            return 1;
        }

        if (!std::filesystem::is_directory(folder))
        {
            std::cerr << "[ERROR] Path is not a directory: " << folder << "\n";
            return 1;
        }

        std::cout << "[INFO] Scanning directory: " << folder << "\n";

        GPMFCombiner combiner;
        std::vector<GPMFResult> results;

        // ✅ Find all MP4 files
        for (auto &entry : std::filesystem::directory_iterator(folder))
        {
            if (entry.path().extension() == ".MP4" || entry.path().extension() == ".mp4")
            {
                std::cout << "[INFO] Extracting " << entry.path().filename().string() << "\n";
                try
                {
                    results.push_back(extractGPMFData(entry.path().string()));
                }
                catch (const std::exception &e)
                {
                    std::cerr << "[WARN] Failed to process " << entry.path()
                              << ": " << e.what() << "\n";
                }
            }
        }

        if (results.empty())
        {
            std::cerr << "[ERROR] No MP4 files found in folder.\n";
            return 1;
        }

        // ✅ Combine and write results
        std::cout << "[INFO] Combining telemetry data...\n";
        GPMFResult merged = combiner.combineResults(results, (std::filesystem::path(folder) / "merged.mp4").string());

        std::string metaFile = (std::filesystem::path(folder) / "merged_gpmf_meta.json").string();
        std::string gpxFile = (std::filesystem::path(folder) / "merged_gpmf_gps.gpx").string();

        writeMetaJson(merged, metaFile);
        writeGPX(merged, gpxFile);

        std::cout << "[INFO] Merged telemetry written to:\n"
                  << "   " << metaFile << "\n"
                  << "   " << gpxFile << "\n";

        return 0;
    }
    catch (const std::exception &e)
    {
        std::cerr << "[FATAL] Unhandled exception: " << e.what() << "\n";
        return 1;
    }
    catch (...)
    {
        std::cerr << "[FATAL] Unknown exception occurred.\n";
        return 1;
    }
}
